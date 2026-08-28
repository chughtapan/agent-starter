/**
 * @file Installs and inspects the single machine-local polling routine.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import { Configuration } from './config.js';
import {
  type ConfigurationError,
  SchedulerError,
  type StorageError,
} from './errors.js';
import { Paths } from './paths.js';
import { Storage } from './storage.js';
import { DocumentTemplates } from './templates.js';

const LABEL = 'dev.social-harness.poller';

/** Result of configuring the one machine-local background routine. */
interface SchedulerResult {
  readonly installed: boolean;
  readonly mechanism: 'launchd' | 'manual';
  readonly detail: string;
}

/** Provides local background routine installation and inspection. */
export interface SchedulerService {
  readonly install: () => Effect.Effect<
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
    const plist = path.join(
      paths.userHome,
      'Library',
      'LaunchAgents',
      `${LABEL}.plist`,
    );
    const platform = Effect.fn('Scheduler.platform')(function* () {
      return yield* processSpawner
        .string(ChildProcess.make('uname', ['-s']))
        .pipe(Effect.catch(() => Effect.succeed('unknown')));
    });

    const launchctl = Effect.fn('Scheduler.launchctl')(function* (
      operation: string,
      arguments_: readonly string[],
    ) {
      const exitCode = yield* processSpawner
        .exitCode(ChildProcess.make('launchctl', [...arguments_]))
        .pipe(
          Effect.mapError((cause) =>
            SchedulerError.make({
              operation,
              reason: 'launchctl could not run',
              cause,
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
          Effect.mapError((cause) =>
            SchedulerError.make({
              operation: 'resolveUser',
              reason: 'could not determine the current macOS user ID',
              cause,
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
      const isDarwin = (yield* platform()).trim() === 'Darwin';
      if (!isDarwin) {
        return {
          installed: false,
          mechanism: 'manual',
          detail: 'run social-harness poll in an existing host scheduler',
        } satisfies SchedulerResult;
      }
      const domain = yield* launchDomain();
      const filePresent = yield* storage.exists(plist);
      const loaded =
        filePresent &&
        (yield* launchctl('status', ['print', `${domain}/${LABEL}`])) === 0;
      let detail = 'launchd routine is not installed';
      if (loaded) {
        detail = plist;
      } else if (filePresent) {
        detail = 'launchd routine exists but is not loaded';
      }
      return {
        installed: loaded,
        mechanism: 'launchd',
        detail,
      } satisfies SchedulerResult;
    });

    const install = Effect.fn('Scheduler.install')(function* () {
      if ((yield* platform()).trim() !== 'Darwin') {
        return {
          installed: false,
          mechanism: 'manual',
          detail: 'run social-harness poll in an existing host scheduler',
        } satisfies SchedulerResult;
      }
      const config = yield* configuration.load();
      const domain = yield* launchDomain();
      const cliPath = path.resolve(process.argv[1] ?? 'social-harness');
      const content = yield* templates
        .launchAgent({
          label: LABEL,
          nodePath: process.execPath,
          cliPath,
          intervalSeconds: durationSeconds(config.polling.interval),
          standardOutPath: paths.events,
          standardErrorPath: path.join(paths.logs, 'poller.err'),
        })
        .pipe(
          Effect.mapError((cause) =>
            SchedulerError.make({
              operation: 'renderLaunchAgent',
              reason: 'could not render the launchd configuration',
              cause,
            }),
          ),
        );
      yield* storage.writeText(plist, content, 0o644);
      yield* launchctl('removeExisting', [
        'bootout',
        `${domain}/${LABEL}`,
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
        detail: plist,
      } satisfies SchedulerResult;
    });

    return { install, status };
  }).pipe(Effect.withSpan('schedulerLayer')),
);
