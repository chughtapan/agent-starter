/**
 * @file Detects supported agent hosts and installs additive, owned adapters.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import { Configuration } from './config.js';
import {
  AdapterProbe,
  OwnershipEntry,
  OwnershipManifest,
} from './domain/runtime.js';
import {
  AdapterError,
  type ConfigurationError,
  StorageError,
  type TemplateError,
} from './errors.js';
import { Paths } from './paths.js';
import { Storage } from './storage.js';
import { DocumentTemplates } from './templates.js';

type AdapterName = (typeof AdapterProbe.Type)['name'];

interface AdapterDefinition {
  readonly name: AdapterName;
  readonly executable: string;
  readonly configPath: string;
}

const HOOK_MARKER = 'social-harness updates --if-needed';

/** Provides host detection and additive adapter installation. */
export interface AdaptersService {
  readonly detect: () => Effect.Effect<
    readonly AdapterProbe[],
    ConfigurationError | StorageError
  >;
  readonly installDetected: () => Effect.Effect<
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
 * @returns A new configuration containing exactly one owned session hook.
 */
export function addSessionHook(value: unknown): Record<string, unknown> {
  const root = asRecord(value);
  const hooks = asRecord(root.hooks);
  const existing = asUnknownArray(hooks.SessionStart);
  if (existing.some((entry) => JSON.stringify(entry).includes(HOOK_MARKER))) {
    return root;
  }
  const socialHarnessHook = {
    hooks: [
      {
        type: 'command',
        command: HOOK_MARKER,
        timeout: 10,
      },
    ],
  };
  return {
    ...root,
    hooks: {
      ...hooks,
      SessionStart: [...existing, socialHarnessHook],
    },
  };
}

/**
 * Reports whether a host config already contains the owned start hook.
 * @param value Host configuration to inspect.
 * @returns Whether the Social Harness session command is present.
 */
export function hasSessionHook(value: unknown): boolean {
  const encoded: unknown = JSON.stringify(value);
  return typeof encoded === 'string' && encoded.includes(HOOK_MARKER);
}

function asRecord(value: unknown): Record<string, unknown> {
  return Predicate.isObject(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function asUnknownArray(value: unknown): readonly unknown[] {
  return Array.isArray(value)
    ? value.map((entry: unknown): unknown => entry)
    : [];
}

function adapterFailure(
  adapter: AdapterName,
  operation: string,
  reason: string,
  cause?: unknown,
): AdapterError {
  return AdapterError.make({
    adapter,
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
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

    const detect = Effect.fn('Adapters.detect')(function* () {
      const config = yield* configuration.load();
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
            const skillInstalled = yield* storage.exists(skillPath);
            const hookInstalled =
              definition.name === 'openClaw'
                ? true
                : hasSessionHook(
                    yield* storage.readJson(definition.configPath),
                  );
            return AdapterProbe.make({
              name: definition.name,
              detected,
              compatible: mode !== 'disabled' && detected,
              installed: detected && skillInstalled && hookInstalled,
              ...(executable === undefined ? {} : { executable }),
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
        try: () => addSessionHook(input),
        catch: (cause) =>
          adapterFailure(
            adapter,
            'mergeHook',
            'could not merge host hooks',
            cause,
          ),
      });
      yield* storage.writeJson(configPath, updated);
    });

    const installDetected = Effect.fn('Adapters.installDetected')(function* () {
      const probes = yield* detect();
      const skill = yield* templates.hostSkill();
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
                  identifier: HOOK_MARKER,
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
                  adapter: probe.name,
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
                    identifier: HOOK_MARKER,
                  }),
                );
              }
            }
            return AdapterProbe.make({
              name: probe.name,
              detected: probe.detected,
              compatible: probe.compatible,
              installed: true,
              ...(probe.executable === undefined
                ? {}
                : { executable: probe.executable }),
              configPath: probe.configPath,
              ...(probe.conflict === undefined
                ? {}
                : { conflict: probe.conflict }),
            });
          }),
        { concurrency: 1 },
      );
      const previousInput = yield* storage.readJson(paths.ownership);
      const previous =
        previousInput === undefined
          ? OwnershipManifest.make({ schemaVersion: 1, entries: [] })
          : yield* Schema.decodeUnknownEffect(OwnershipManifest)(
              previousInput,
            ).pipe(
              Effect.mapError((cause) =>
                StorageError.make({
                  operation: 'decodeJson',
                  path: paths.ownership,
                  cause,
                }),
              ),
            );
      const entries = [...previous.entries, ...ownership].filter(
        (entry, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.kind === entry.kind &&
              candidate.adapter === entry.adapter &&
              candidate.path === entry.path &&
              candidate.identifier === entry.identifier,
          ) === index,
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
