/**
 * @file Installs and inspects the single machine-local polling routine.
 */

import * as Config from 'effect/Config';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  mergeOwnershipEntries,
  OwnershipEntry,
  OwnershipManifest,
} from '../domain/runtime.js';
import {
  Configuration,
  type ConfigurationError,
} from '../platform/configuration/index.js';
import { DocumentTemplates } from '../platform/documents/index.js';
import { Paths, Storage, StorageError } from '../platform/persistence/index.js';
import { SchedulerError } from './errors.js';

const LABEL = 'dev.social-harness.poller';

/** Result of configuring the one machine-local background routine. */
interface SchedulerResult {
  readonly installed: boolean;
  readonly mechanism: 'launchd' | 'manual';
  readonly detail: string;
}

/** Requests a validated preview without scheduler or filesystem changes. */
export interface SchedulerInstallOptions {
  readonly dryRun?: boolean;
}

/** Provides local background routine installation and inspection. */
export interface SchedulerService {
  readonly install: (
    options?: SchedulerInstallOptions,
  ) => Effect.Effect<
    SchedulerResult,
    ConfigurationError | SchedulerError | StorageError
  >;
  readonly status: () => Effect.Effect<
    SchedulerResult,
    SchedulerError | StorageError
  >;
}

/** Identifies the machine-local scheduler adapter. */
export class Scheduler extends Context.Service<Scheduler, SchedulerService>()(
  'social-harness/Scheduler',
) {}

function durationSeconds(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (match === null) {
    return 900;
  }
  return (
    Number(match[1] ?? '0') * 3_600 +
    Number(match[2] ?? '0') * 60 +
    Number(match[3] ?? '0')
  );
}

/** Uses launchd only as a timer; collaboration behavior remains host-neutral. */
export const schedulerLayer = Layer.effect(Scheduler)(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const paths = yield* Paths;
    const storage = yield* Storage;
    const templates = yield* DocumentTemplates;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const configuration = yield* Configuration;
    const configProvider = yield* ConfigProvider.ConfigProvider;
    const platform = Effect.fn('Scheduler.platform')(function* () {
      return yield* processSpawner
        .string(ChildProcess.make('uname', ['-s']))
        .pipe(Effect.catch(() => Effect.succeed('unknown')));
    });

    const settings = Effect.fn('Scheduler.settings')(function* () {
      const configuredMode = yield* Config.option(
        Config.literals(['manual', 'launchd'], 'SOCIAL_HARNESS_SCHEDULER_MODE'),
      ).parse(configProvider);
      const configuredLabel = yield* Config.option(
        Config.schema(
          Schema.String.check(
            Schema.isPattern(
              /^dev\.social-harness\.eval\.[a-z0-9][a-z0-9-]{0,63}$/,
            ),
          ),
          'SOCIAL_HARNESS_LAUNCHD_LABEL',
        ),
      ).parse(configProvider);
      const label = Option.getOrElse(configuredLabel, () => LABEL);
      const systemHome = yield* Config.string('HOME').parse(configProvider);
      const isolatedHome = yield* Config.option(
        Config.string('SOCIAL_HARNESS_USER_HOME'),
      ).parse(configProvider);
      let mode = Option.getOrUndefined(configuredMode);
      mode ??= (yield* platform()).trim() === 'Darwin' ? 'launchd' : 'manual';
      if (
        mode === 'launchd' &&
        label === LABEL &&
        (Option.isSome(isolatedHome) ||
          path.resolve(paths.userHome) !== path.resolve(systemHome))
      ) {
        return yield* Effect.fail(
          SchedulerError.make({
            operation: 'preflight',
            reason:
              'an isolated user home must use manual scheduling or a dev.social-harness.eval label',
          }),
        );
      }
      return {
        mode,
        label,
        plist: path.join(
          paths.userHome,
          'Library',
          'LaunchAgents',
          `${label}.plist`,
        ),
      };
    });

    const loadSettings = () =>
      settings().pipe(
        Effect.catchTag('ConfigError', () =>
          Effect.fail(
            SchedulerError.make({
              operation: 'configuration',
              reason: 'invalid scheduler environment',
            }),
          ),
        ),
      );

    const recordOwnership = Effect.fn('Scheduler.recordOwnership')(function* (
      plist: string,
      label: string,
    ) {
      const input = yield* storage.readJson(paths.ownership);
      const previous =
        input === undefined
          ? OwnershipManifest.make({ schemaVersion: 1, entries: [] })
          : yield* Schema.decodeUnknownEffect(OwnershipManifest)(input).pipe(
              Effect.mapError(() =>
                StorageError.make({
                  operation: 'decodeJson',
                  path: paths.ownership,
                }),
              ),
            );
      const resource = OwnershipEntry.make({
        kind: 'scheduler',
        adapter: 'shared',
        path: plist,
        identifier: label,
      });
      yield* storage.writeJson(
        paths.ownership,
        OwnershipManifest.make({
          schemaVersion: 1,
          entries: mergeOwnershipEntries(previous.entries, [resource]),
        }),
      );
    });

    const launchctl = Effect.fn('Scheduler.launchctl')(function* (
      operation: string,
      arguments_: readonly string[],
    ) {
      const exitCode = yield* processSpawner
        .exitCode(ChildProcess.make('launchctl', [...arguments_]))
        .pipe(
          Effect.mapError(() =>
            SchedulerError.make({
              operation,
              reason: 'launchctl could not run',
            }),
          ),
        );
      return Number(exitCode);
    });

    const launchDomain = Effect.fn('Scheduler.launchDomain')(function* () {
      const uid = yield* processSpawner
        .string(ChildProcess.make('id', ['-u']))
        .pipe(
          Effect.map((value) => value.trim()),
          Effect.mapError(() =>
            SchedulerError.make({
              operation: 'resolveUser',
              reason: 'could not determine the current macOS user ID',
            }),
          ),
        );
      if (!/^\d+$/.test(uid)) {
        return yield* Effect.fail(
          SchedulerError.make({
            operation: 'resolveUser',
            reason: `unexpected user ID: ${uid}`,
          }),
        );
      }
      return `gui/${uid}`;
    });

    const status = Effect.fn('Scheduler.status')(function* () {
      const { mode, label, plist } = yield* loadSettings();
      if (mode === 'manual') {
        return {
          installed: false,
          mechanism: 'manual',
          detail: 'manual mode; no background routine installed',
        } satisfies SchedulerResult;
      }
      const domain = yield* launchDomain();
      const filePresent = yield* storage.exists(plist);
      const loaded =
        filePresent &&
        (yield* launchctl('status', ['print', `${domain}/${label}`])) === 0;
      let detail = 'launchd routine is not installed';
      if (loaded) {
        detail = 'launchd loaded; successful polling requires a separate check';
      } else if (filePresent) {
        detail = 'launchd routine exists but is not loaded';
      }
      return {
        installed: loaded,
        mechanism: 'launchd',
        detail,
      } satisfies SchedulerResult;
    });

    const install = Effect.fn('Scheduler.install')(function* (
      options?: SchedulerInstallOptions,
    ) {
      const { mode, label, plist } = yield* loadSettings();
      if (mode === 'manual') {
        return {
          installed: false,
          mechanism: 'manual',
          detail: 'manual mode; no background routine installed',
        } satisfies SchedulerResult;
      }
      const config = yield* configuration.load();
      const domain = yield* launchDomain();
      const bootstrap = yield* Config.string('SOCIAL_HARNESS_BOOTSTRAP')
        .pipe(Config.withDefault(process.argv[1] ?? 'social-harness'))
        .parse(configProvider)
        .pipe(
          Effect.mapError(() =>
            SchedulerError.make({
              operation: 'configuration',
              reason: 'invalid bootstrap path',
            }),
          ),
        );
      const cliPath = path.resolve(bootstrap);
      const content = yield* templates
        .launchAgent({
          label,
          nodePath: process.execPath,
          cliPath,
          intervalSeconds: durationSeconds(config.polling.interval),
          standardOutPath: paths.events,
          standardErrorPath: path.join(paths.logs, 'poller.err'),
          environment: {
            SOCIAL_HARNESS_HOME: paths.home,
            AGENTMAIL_HOME: paths.agentmailHome,
            CLAUDE_CONFIG_DIR: paths.claudeHome,
            CODEX_HOME: paths.codexHome,
            SOCIAL_HARNESS_SCHEDULER_MODE: mode,
            SOCIAL_HARNESS_BOOTSTRAP: cliPath,
            ...(label === LABEL
              ? {}
              : {
                  SOCIAL_HARNESS_LAUNCHD_LABEL: label,
                  SOCIAL_HARNESS_USER_HOME: paths.userHome,
                }),
          },
        })
        .pipe(
          Effect.mapError(() =>
            SchedulerError.make({
              operation: 'renderLaunchAgent',
              reason: 'could not render the launchd configuration',
            }),
          ),
        );
      if (options?.dryRun === true) {
        return {
          installed: false,
          mechanism: 'launchd',
          detail: `Would install ${plist}`,
        } satisfies SchedulerResult;
      }
      const unchanged = (yield* storage.readText(plist)) === content;
      yield* recordOwnership(plist, label);
      if (unchanged) {
        const current = yield* status();
        if (current.installed) {
          return current;
        }
      }
      yield* storage.writeText(plist, content, 0o644);
      yield* launchctl('removeExisting', [
        'bootout',
        `${domain}/${label}`,
      ]).pipe(Effect.ignore);
      const loadExitCode = yield* launchctl('install', [
        'bootstrap',
        domain,
        plist,
      ]);
      if (loadExitCode !== 0) {
        return yield* Effect.fail(
          SchedulerError.make({
            operation: 'install',
            reason: `launchctl bootstrap exited with ${String(loadExitCode)}`,
          }),
        );
      }
      const verified = yield* status();
      if (!verified.installed) {
        return yield* Effect.fail(
          SchedulerError.make({
            operation: 'verify',
            reason: verified.detail,
          }),
        );
      }
      return {
        installed: true,
        mechanism: 'launchd',
        detail: 'launchd loaded; successful polling requires a separate check',
      } satisfies SchedulerResult;
    });

    return { install, status };
  }).pipe(Effect.withSpan('schedulerLayer')),
);
