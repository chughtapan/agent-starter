/**
 * @file Detects supported agent hosts and installs additive, owned adapters.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  AdapterProbe,
  type HostHookEvent,
  mergeOwnershipEntries,
  OwnershipEntry,
  OwnershipManifest,
} from '../domain/runtime.js';
import {
  Configuration,
  type ConfigurationError,
} from '../platform/configuration/index.js';
import {
  DocumentTemplates,
  type TemplateError,
} from '../platform/documents/index.js';
import { Paths, Storage, StorageError } from '../platform/persistence/index.js';
import { AdapterError } from './errors.js';

type AdapterName = (typeof AdapterProbe.Type)['name'];

interface AdapterDefinition {
  readonly name: AdapterName;
  readonly executable: string;
  readonly configPath: string;
}

const LEGACY_HOOK = 'social-harness updates --if-needed';
const HOOK_EVENTS: ReadonlyArray<typeof HostHookEvent.Type> = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'Stop',
];
const recordSchema = Schema.Record(Schema.String, Schema.Unknown);
const arraySchema = Schema.Array(Schema.Unknown);

/** Preview installation without changing any owned resource. */
export interface AdapterInstallOptions {
  readonly dryRun?: boolean;
}

/** Provides host detection and additive adapter installation. */
export interface AdaptersService {
  readonly detect: () => Effect.Effect<
    readonly AdapterProbe[],
    ConfigurationError | StorageError
  >;
  readonly installDetected: (
    options?: AdapterInstallOptions,
  ) => Effect.Effect<
    readonly AdapterProbe[],
    AdapterError | ConfigurationError | StorageError | TemplateError
  >;
}

/** Identifies supported coding-agent host adapters. */
export class Adapters extends Context.Service<Adapters, AdaptersService>()(
  'social-harness/Adapters',
) {}

/**
 * Adds the owned hook while preserving every non-owned host setting.
 * @param value Existing host configuration from an untrusted JSON boundary.
 * @param host Native host whose command invocation supplies provenance.
 * @returns A configuration with one owned handler at each supported boundary.
 */
export function addSessionHook(
  value: unknown,
  host?: 'claude' | 'codex',
): Record<string, unknown> {
  const source = host ?? 'native';
  const root = Schema.decodeUnknownSync(recordSchema)(value ?? {});
  const hooks = Schema.decodeUnknownSync(recordSchema)(root.hooks ?? {});
  const updated = { ...hooks };
  for (const event of HOOK_EVENTS) {
    const existing = Schema.decodeUnknownSync(arraySchema)(hooks[event] ?? []);
    const preserved = existing.flatMap(preserveUnownedGroup);
    updated[event] = [
      ...preserved,
      {
        hooks: [
          { type: 'command', command: hookCommand(event, source), timeout: 10 },
        ],
      },
    ];
  }
  return { ...root, hooks: updated };
}

/**
 * Reports whether a host config already contains the owned start hook.
 * @param value Host configuration to inspect.
 * @param host Required native host provenance, when known.
 * @returns Whether the Social Harness session command is present.
 */
export function hasSessionHook(
  value: unknown,
  host?: 'claude' | 'codex',
): boolean {
  const source = host ?? 'native';
  if (
    !Schema.is(recordSchema)(value) ||
    !Schema.is(recordSchema)(value.hooks)
  ) {
    return false;
  }
  const hooks = value.hooks;
  return HOOK_EVENTS.every((event) => {
    const groups = hooks[event];
    if (!Schema.is(arraySchema)(groups)) {
      return false;
    }
    return groups.some((group) => {
      if (
        !Schema.is(recordSchema)(group) ||
        !Schema.is(arraySchema)(group.hooks)
      ) {
        return false;
      }
      if (
        group.matcher !== undefined &&
        group.matcher !== '' &&
        group.matcher !== '*'
      ) {
        return false;
      }
      return group.hooks.some(
        (handler) =>
          Schema.is(recordSchema)(handler) &&
          handler.type === 'command' &&
          handler.command === hookCommand(event, source) &&
          handler.timeout === 10,
      );
    });
  });
}

function hookCommand(
  event: typeof HostHookEvent.Type,
  host: 'claude' | 'codex' | 'native',
): string {
  const suffix = host === 'native' ? '' : ` --host ${host}`;
  return `social-harness host-hook --event ${event}${suffix}`;
}

function isOwnedHandler(value: unknown): boolean {
  return (
    Schema.is(recordSchema)(value) &&
    value.type === 'command' &&
    (value.command === LEGACY_HOOK ||
      HOOK_EVENTS.some(
        (event) =>
          value.command === hookCommand(event, 'native') ||
          value.command === hookCommand(event, 'claude') ||
          value.command === hookCommand(event, 'codex'),
      ))
  );
}

function preserveUnownedGroup(value: unknown): readonly unknown[] {
  if (!Schema.is(recordSchema)(value) || !Schema.is(arraySchema)(value.hooks)) {
    return [value];
  }
  const remaining = value.hooks.filter((handler) => !isOwnedHandler(handler));
  if (remaining.length === value.hooks.length) {
    return [value];
  }
  return remaining.length === 0 ? [] : [{ ...value, hooks: remaining }];
}

function adapterFailure(
  adapter: AdapterName,
  operation: string,
  reason: string,
): AdapterError {
  return AdapterError.make({
    adapter,
    operation,
    reason,
  });
}

/** Provides additive, idempotent host setup backed by an ownership manifest. */
export const adaptersLayer = Layer.effect(Adapters)(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const paths = yield* Paths;
    const storage = yield* Storage;
    const templates = yield* DocumentTemplates;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const configuration = yield* Configuration;

    const findExecutable = Effect.fn('Adapters.findExecutable')(function* (
      executable: string,
    ) {
      const output = yield* processSpawner
        .string(ChildProcess.make('which', [executable]))
        .pipe(Effect.catch(() => Effect.succeed('')));
      const resolved = output.trim().split('\n')[0];
      return resolved === undefined || resolved.length === 0
        ? undefined
        : resolved;
    });

    const readVersion = Effect.fn('Adapters.readVersion')(function* (
      executable: string,
    ) {
      return yield* processSpawner
        .string(ChildProcess.make(executable, ['--version']))
        .pipe(
          Effect.timeout('2 seconds'),
          Effect.map((value) => value.trim().split('\n')[0]),
          Effect.catch(() => Effect.succeed(undefined)),
        );
    });

    const detect = Effect.fn('Adapters.detect')(function* () {
      const config = yield* configuration.load();
      const expectedSkill = yield* templates
        .hostSkill()
        .pipe(Effect.catch(() => Effect.succeed(undefined)));
      const definitions: readonly AdapterDefinition[] = [
        {
          name: 'claude',
          executable: 'claude',
          configPath: path.join(paths.claudeHome, 'settings.json'),
        },
        {
          name: 'codex',
          executable: 'codex',
          configPath: path.join(paths.codexHome, 'hooks.json'),
        },
        {
          name: 'openClaw',
          executable: 'openclaw',
          configPath: path.join(paths.openClawHome, 'openclaw.json'),
        },
      ];
      return yield* Effect.forEach(
        definitions,
        (definition) =>
          Effect.gen(function* () {
            const executable = yield* findExecutable(definition.executable);
            const version =
              executable === undefined
                ? undefined
                : yield* readVersion(executable);
            const mode = config.adapters[definition.name].mode;
            const detected = executable !== undefined;
            const skillPath =
              definition.name === 'claude'
                ? path.join(
                    paths.claudeHome,
                    'skills',
                    'social-harness',
                    'SKILL.md',
                  )
                : path.join(
                    paths.agentsHome,
                    'skills',
                    'social-harness',
                    'SKILL.md',
                  );
            const skillInstalled =
              expectedSkill !== undefined &&
              (yield* storage.readText(skillPath)) === expectedSkill;
            const hookInstalled =
              definition.name === 'openClaw'
                ? true
                : hasSessionHook(
                    yield* storage.readJson(definition.configPath),
                    definition.name,
                  );
            return AdapterProbe.make({
              name: definition.name,
              detected,
              compatible: mode !== 'disabled' && detected,
              installed: detected && skillInstalled && hookInstalled,
              capability: 'unverified',
              trust: definition.name === 'codex' ? 'unverified' : 'notRequired',
              ...(executable === undefined ? {} : { executable }),
              ...(version === undefined ? {} : { version }),
              configPath: definition.configPath,
              ...(mode === 'disabled'
                ? { conflict: 'disabled by user configuration' }
                : {}),
            });
          }),
        { concurrency: 3 },
      );
    });

    const writeHookConfig = Effect.fn('Adapters.writeHookConfig')(function* (
      adapter: 'claude' | 'codex',
      configPath: string,
    ) {
      const input = yield* storage.readJson(configPath);
      const updated = yield* Effect.try({
        try: () => addSessionHook(input, adapter),
        catch: () =>
          adapterFailure(adapter, 'mergeHook', 'could not merge host hooks'),
      });
      yield* storage.writeJson(configPath, updated);
    });

    const installDetected = Effect.fn('Adapters.installDetected')(function* (
      options?: AdapterInstallOptions,
    ) {
      const probes = yield* detect();
      const skill = yield* templates.hostSkill();
      const previousInput = yield* storage.readJson(paths.ownership);
      const previous =
        previousInput === undefined
          ? OwnershipManifest.make({ schemaVersion: 1, entries: [] })
          : yield* Schema.decodeUnknownEffect(OwnershipManifest)(
              previousInput,
            ).pipe(
              Effect.mapError(() =>
                StorageError.make({
                  operation: 'decodeJson',
                  path: paths.ownership,
                }),
              ),
            );
      const sharedSkillPath = path.join(
        paths.agentsHome,
        'skills',
        'social-harness',
        'SKILL.md',
      );
      const sharedSkill = yield* storage.readText(sharedSkillPath);
      const ownsSharedSkill = previous.entries.some(
        (entry) =>
          entry.kind === 'file' &&
          entry.path === sharedSkillPath &&
          entry.adapter !== 'claude',
      );
      if (
        sharedSkill !== undefined &&
        sharedSkill !== skill &&
        !ownsSharedSkill &&
        probes.some((probe) => probe.name !== 'claude' && probe.compatible)
      ) {
        return yield* Effect.fail(
          adapterFailure(
            'codex',
            'preflight',
            'the shared skill differs and is not recorded as owned; reconcile that conflict before replacing it',
          ),
        );
      }
      // Validate every host merge before performing any writes.
      for (const probe of probes) {
        if (
          probe.compatible &&
          probe.name !== 'openClaw' &&
          probe.configPath !== undefined
        ) {
          const input = yield* storage.readJson(probe.configPath);
          yield* Effect.try({
            try: () =>
              addSessionHook(
                input,
                probe.name === 'claude' ? 'claude' : 'codex',
              ),
            catch: () =>
              adapterFailure(
                probe.name,
                'preflight',
                'host hooks have an unsupported structure',
              ),
          });
        }
      }
      if (options?.dryRun === true) {
        return probes;
      }
      const ownership: OwnershipEntry[] = [];
      const installed = yield* Effect.forEach(
        probes,
        (probe) =>
          Effect.gen(function* () {
            if (!probe.compatible || probe.configPath === undefined) {
              return probe;
            }
            if (probe.name === 'claude') {
              yield* writeHookConfig('claude', probe.configPath);
              const skillPath = path.join(
                paths.claudeHome,
                'skills',
                'social-harness',
                'SKILL.md',
              );
              yield* storage.writeText(skillPath, skill, 0o644);
              ownership.push(
                OwnershipEntry.make({
                  kind: 'configEntry',
                  adapter: 'claude',
                  path: probe.configPath,
                  identifier: 'social-harness host-hook',
                }),
                OwnershipEntry.make({
                  kind: 'file',
                  adapter: 'claude',
                  path: skillPath,
                }),
              );
            } else {
              const skillPath = path.join(
                paths.agentsHome,
                'skills',
                'social-harness',
                'SKILL.md',
              );
              yield* storage.writeText(skillPath, skill, 0o644);
              ownership.push(
                OwnershipEntry.make({
                  kind: 'file',
                  adapter: 'shared',
                  path: skillPath,
                }),
              );
              if (probe.name === 'codex') {
                yield* writeHookConfig('codex', probe.configPath);
                ownership.push(
                  OwnershipEntry.make({
                    kind: 'configEntry',
                    adapter: 'codex',
                    path: probe.configPath,
                    identifier: 'social-harness host-hook',
                  }),
                );
              }
            }
            return AdapterProbe.make({
              name: probe.name,
              detected: probe.detected,
              compatible: probe.compatible,
              installed: true,
              capability: 'unverified',
              trust: probe.name === 'codex' ? 'unverified' : 'notRequired',
              ...(probe.executable === undefined
                ? {}
                : { executable: probe.executable }),
              ...(probe.version === undefined
                ? {}
                : { version: probe.version }),
              configPath: probe.configPath,
              ...(probe.conflict === undefined
                ? {}
                : { conflict: probe.conflict }),
            });
          }),
        { concurrency: 1 },
      );
      const entries = mergeOwnershipEntries(
        previous.entries.filter(
          (entry) =>
            entry.identifier !== LEGACY_HOOK ||
            !ownership.some((owned) => owned.path === entry.path),
        ),
        ownership,
      );
      yield* storage.writeJson(
        paths.ownership,
        OwnershipManifest.make({ schemaVersion: 1, entries }),
      );
      return installed;
    });

    return { detect, installDetected };
  }).pipe(Effect.withSpan('adaptersLayer')),
);
