/**
 * @file Coordinates staged stable releases, atomic activation, and rollback.
 */

import * as Clock from 'effect/Clock';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import { fileURLToPath } from 'node:url';

import { HarnessEvent, OwnershipManifest } from '../domain/runtime.js';
import {
  ActivationJournal,
  ActiveRelease,
  SoftwareUpdateState,
  UpgradeError,
  UpgradeStatus,
} from '../domain/upgrades.js';
import { Configuration } from '../platform/configuration/index.js';
import { Paths, Storage } from '../platform/persistence/index.js';
import { ReleasePackages, Upgrades, type UpgradesService } from './ports.js';

type AdapterSnapshot = ActivationJournal['snapshots'][number];

/** Builds software updates on the existing configuration and platform services. */
export const upgradesLayer = Layer.effect(Upgrades)(
  Effect.gen(function* () {
    const paths = yield* Paths;
    const path = yield* Path.Path;
    const storage = yield* Storage;
    const fileSystem = yield* FileSystem.FileSystem;
    const configuration = yield* Configuration;
    const packages = yield* ReleasePackages;
    const configuredBootstrap = yield* Config.option(
      Config.string('SOCIAL_HARNESS_BOOTSTRAP'),
    );
    const baselineRoot = Option.match(configuredBootstrap, {
      onNone: () => fileURLToPath(new URL('../../', import.meta.url)),
      onSome: (bootstrap) => path.resolve(path.dirname(bootstrap), '../..'),
    });
    const activePath = path.join(paths.runtime, 'active-release.json');
    const journalPath = path.join(paths.runtime, 'activation-journal.json');
    const statePath = path.join(paths.state, 'software-updates.json');
    const versionsRoot = path.join(paths.runtime, 'versions');
    const lockPath = path.join(paths.runtime, 'upgrade.lock');

    const readActive = Effect.fn('Upgrades.readActive')(function* () {
      const value = yield* storage.readJson(activePath);
      if (value === undefined) {
        const version = yield* packages.runningVersion();
        return ActiveRelease.make({
          schemaVersion: 1,
          current: version,
          baseline: version,
        });
      }
      return yield* Schema.decodeUnknownEffect(ActiveRelease)(value);
    });

    const readState = Effect.fn('Upgrades.readState')(function* () {
      const value = yield* storage.readJson(statePath);
      return value === undefined
        ? SoftwareUpdateState.make({ schemaVersion: 1, quarantined: [] })
        : yield* Schema.decodeUnknownEffect(SoftwareUpdateState)(value);
    });

    const inspect = Effect.fn('Upgrades.inspect')(function* () {
      const active = yield* readActive();
      const release = yield* packages.latest();
      const state = yield* readState();
      let status: UpgradeStatus;
      if (release === undefined) {
        status = UpgradeStatus.make({
          status: 'noRelease',
          currentVersion: active.current,
          detail: 'No stable GitHub release has been published.',
        });
      } else if (!newerVersion(release.version, active.current)) {
        status = UpgradeStatus.make({
          status: 'current',
          currentVersion: active.current,
          detail:
            'The active version is current; automatic downgrades are disabled.',
        });
      } else if (state.quarantined.includes(release.version)) {
        status = UpgradeStatus.make({
          status: 'quarantined',
          currentVersion: active.current,
          candidateVersion: release.version,
          detail:
            'This release failed verification or was rolled back. It will not be installed again automatically.',
        });
      } else {
        status = UpgradeStatus.make({
          status: 'available',
          currentVersion: active.current,
          candidateVersion: release.version,
          detail:
            'A stable release is available for checksum verification and staging.',
        });
      }
      return { active, release, state, status };
    });

    const status = Effect.fn('Upgrades.status')(function* () {
      const active = yield* readActive();
      const state = yield* readState();
      const config = yield* configuration.load();
      return UpgradeStatus.make({
        status: config.softwareUpdates.enabled ? 'current' : 'disabled',
        currentVersion: active.current,
        detail:
          state.lastError ??
          (config.softwareUpdates.enabled
            ? `Automatic stable-release checks run every ${config.softwareUpdates.checkInterval} while this machine is awake.`
            : 'Automatic software updates are disabled; explicit check, apply, and rollback remain available.'),
      });
    });

    const quarantine = Effect.fn('Upgrades.quarantine')(function* (
      version: string,
      reason: string,
    ) {
      const state = yield* readState();
      yield* storage.writeJson(
        statePath,
        SoftwareUpdateState.make({
          schemaVersion: 1,
          lastCheckedAt: state.lastCheckedAt,
          quarantined: [...new Set([...state.quarantined, version])],
          lastError: reason,
        }),
      );
    });

    const packageRoot = (version: string) =>
      path.join(versionsRoot, version, 'node_modules', 'social-harness');
    const cliPath = (version: string) =>
      path.join(packageRoot(version), 'dist', 'cli.js');

    const snapshotAdapters = Effect.fn('Upgrades.snapshotAdapters')(
      function* () {
        const manifestInput = yield* storage.readJson(paths.ownership);
        const manifest =
          manifestInput === undefined
            ? OwnershipManifest.make({ schemaVersion: 1, entries: [] })
            : yield* Schema.decodeUnknownEffect(OwnershipManifest)(
                manifestInput,
              );
        const ownedPaths = [
          ...manifest.entries
            .filter((entry) => entry.kind !== 'scheduler')
            .map((entry) => entry.path),
          path.join(paths.claudeHome, 'settings.json'),
          path.join(paths.codexHome, 'hooks.json'),
          path.join(paths.claudeHome, 'skills', 'social-harness', 'SKILL.md'),
          path.join(paths.agentsHome, 'skills', 'social-harness', 'SKILL.md'),
          paths.ownership,
        ];
        return yield* Effect.forEach(
          [...new Set(ownedPaths)],
          Effect.fn('Upgrades.snapshotAdapter')(function* (ownedPath) {
            const content = yield* storage.readText(ownedPath);
            const mode =
              content === undefined
                ? 0o600
                : (yield* fileSystem.stat(ownedPath)).mode & 0o777;
            return {
              path: ownedPath,
              ...(content === undefined ? {} : { content }),
              mode,
            };
          }),
          { concurrency: 1 },
        );
      },
    );

    const restoreAdapters = Effect.fn('Upgrades.restoreAdapters')(function* (
      active: ActiveRelease,
      snapshots: readonly AdapterSnapshot[],
    ) {
      yield* Effect.forEach(
        snapshots,
        (snapshot) =>
          snapshot.content === undefined
            ? storage.remove(snapshot.path)
            : storage.writeText(snapshot.path, snapshot.content, snapshot.mode),
        { concurrency: 1 },
      );
      yield* storage.writeJson(activePath, active);
    });

    const restoreJournal = Effect.fn('Upgrades.restoreJournal')(function* (
      journal: ActivationJournal,
    ) {
      yield* restoreAdapters(journal.previous, journal.snapshots);
      if (journal.operation === 'activate') {
        yield* quarantine(
          journal.next.current,
          'The release activation did not finish. The previous selection and adapter files were restored.',
        );
      }
      // A failed or interrupted restoration keeps the journal for the next run.
      yield* storage.remove(journalPath);
      return UpgradeStatus.make({
        status: journal.operation === 'activate' ? 'rolledBack' : 'current',
        currentVersion: journal.previous.current,
        detail:
          'An interrupted software transition was restored from its saved selection and adapter files.',
      });
    });

    const recoverJournal = Effect.fn('Upgrades.recoverJournal')(function* () {
      const value = yield* storage.readJson(journalPath);
      if (value === undefined) {
        return undefined;
      }
      const journal =
        yield* Schema.decodeUnknownEffect(ActivationJournal)(value);
      return yield* restoreJournal(journal);
    });

    const activate = Effect.fn('Upgrades.activate')(function* (
      next: ActiveRelease,
      previous: ActiveRelease,
    ) {
      const snapshots = yield* snapshotAdapters();
      const journal = ActivationJournal.make({
        schemaVersion: 1,
        operation: 'activate',
        previous,
        next,
        snapshots,
      });
      yield* storage.writeJson(journalPath, journal);
      yield* storage.writeJson(activePath, next);
      const repaired = yield* packages
        .repair(cliPath(next.current))
        .pipe(Effect.result);
      if (repaired._tag === 'Failure') {
        const restoration = yield* restoreJournal(journal).pipe(Effect.result);
        if (restoration._tag === 'Failure') {
          return yield* Effect.fail(
            UpgradeError.make({
              operation: 'rollback',
              reason:
                'Activation failed and restoring owned adapter files also failed. Run collaboration setup repair before continuing.',
            }),
          );
        }
        return yield* Effect.fail(
          UpgradeError.make({
            operation: 'repair',
            reason:
              'The candidate adapter repair failed; the previous release and adapter files were restored.',
          }),
        );
      }
      yield* storage.remove(journalPath);
    });

    const applyLatest = Effect.fn('Upgrades.applyLatest')(function* () {
      yield* recoverJournal();
      const inspected = yield* inspect();
      if (
        inspected.release === undefined ||
        inspected.status.status !== 'available'
      ) {
        return inspected.status;
      }
      const release = inspected.release;
      const attempt = Effect.gen(function* () {
        yield* storage.ensureDirectory(versionsRoot);
        const destination = path.join(versionsRoot, release.version);
        if (yield* storage.exists(destination)) {
          return yield* Effect.fail(
            UpgradeError.make({
              operation: 'stage',
              reason:
                'An unactivated directory already exists for this release. Inspect it before retrying; existing files were preserved.',
            }),
          );
        }
        const stagingRoot = yield* fileSystem.makeTempDirectory({
          directory: paths.runtime,
          prefix: '.upgrade-',
        });
        yield* packages.stage(release, stagingRoot).pipe(
          Effect.andThen(fileSystem.rename(stagingRoot, destination)),
          Effect.onError(() =>
            fileSystem
              .remove(stagingRoot, { recursive: true })
              .pipe(Effect.ignore),
          ),
        );
        const next = ActiveRelease.make({
          schemaVersion: 1,
          baseline: inspected.active.baseline,
          current: release.version,
          ...(inspected.active.current === inspected.active.baseline
            ? {}
            : { previous: inspected.active.current }),
        });
        const state = yield* readState();
        yield* storage.writeJson(
          statePath,
          SoftwareUpdateState.make({
            schemaVersion: 1,
            lastCheckedAt: state.lastCheckedAt,
            quarantined: state.quarantined,
          }),
        );
        yield* activate(next, inspected.active);
        return UpgradeStatus.make({
          status: 'updated',
          currentVersion: release.version,
          detail:
            'The verified stable release is active and owned adapter resources were reconciled.',
        });
      });

      return yield* attempt.pipe(
        Effect.catch((error) =>
          quarantine(
            release.version,
            'The stable release failed staging or activation; inspect upgrade status before repair.',
          ).pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
    });

    const withLock = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        yield* storage.ensureDirectory(paths.runtime);
        return yield* Effect.acquireUseRelease(
          fileSystem.makeDirectory(lockPath, { mode: 0o700 }).pipe(
            Effect.mapError(() =>
              UpgradeError.make({
                operation: 'lock',
                reason: `Another update may be running. If it was interrupted, inspect and remove only ${lockPath} after confirming it stopped.`,
              }),
            ),
          ),
          () => operation,
          () =>
            fileSystem
              .remove(lockPath, { recursive: true })
              .pipe(Effect.ignore),
        );
      });

    const recover = Effect.fn('Upgrades.recover')(function* () {
      if (!(yield* storage.exists(journalPath))) {
        return undefined;
      }
      return yield* withLock(recoverJournal());
    });

    const rollback = Effect.fn('Upgrades.rollback')(function* (dryRun = false) {
      const active = yield* readActive();
      const previous = active.previous ?? active.baseline;
      if (active.current === previous) {
        return UpgradeStatus.make({
          status: 'current',
          currentVersion: active.current,
          detail: 'No previous release is available to restore.',
        });
      }
      if (dryRun) {
        return UpgradeStatus.make({
          status: 'available',
          currentVersion: active.current,
          candidateVersion: previous,
          detail:
            'Rollback would restore this previous version and quarantine the current version.',
        });
      }
      return yield* withLock(
        Effect.gen(function* () {
          yield* recoverJournal();
          const lockedActive = yield* readActive();
          if (lockedActive.current !== active.current) {
            return yield* Effect.fail(
              UpgradeError.make({
                operation: 'rollback',
                reason:
                  'The active version changed while rollback was being inspected. Check the current version and retry.',
              }),
            );
          }
          const scratchRoot = yield* fileSystem.makeTempDirectoryScoped({
            prefix: 'social-harness-rollback-',
          });
          const previousPackage =
            previous === active.baseline ? baselineRoot : packageRoot(previous);
          yield* packages.verify(previousPackage, previous, scratchRoot);
          const snapshots = yield* snapshotAdapters();
          const restored = ActiveRelease.make({
            schemaVersion: 1,
            baseline: active.baseline,
            current: previous,
          });
          const journal = ActivationJournal.make({
            schemaVersion: 1,
            operation: 'rollback',
            previous: active,
            next: restored,
            snapshots,
          });
          yield* storage.writeJson(journalPath, journal);
          yield* storage.writeJson(activePath, restored);
          const repair = yield* packages
            .repair(path.join(previousPackage, 'dist', 'cli.js'))
            .pipe(Effect.result);
          if (repair._tag === 'Failure') {
            const restoration = yield* restoreJournal(journal).pipe(
              Effect.result,
            );
            if (restoration._tag === 'Failure') {
              return yield* Effect.fail(
                UpgradeError.make({
                  operation: 'rollback',
                  reason:
                    'Previous adapter repair failed and restoring the original owned files also failed. Inspect the active selection and run collaboration setup repair before continuing.',
                }),
              );
            }
            return yield* Effect.fail(
              UpgradeError.make({
                operation: 'rollback',
                reason:
                  'Previous adapter repair failed; the original active release and owned files were restored.',
              }),
            );
          }
          yield* quarantine(
            active.current,
            'The owner or bootstrap rolled back this release. Automatic reinstallation is disabled.',
          );
          yield* storage.remove(journalPath);
          return UpgradeStatus.make({
            status: 'rolledBack',
            currentVersion: previous,
            detail:
              'The previous release and its owned adapter resources are active.',
          });
        }).pipe(Effect.scoped),
      );
    });

    const checkIfDue = Effect.fn('Upgrades.checkIfDue')(function* () {
      const config = yield* configuration.load();
      const active = yield* readActive();
      if (!config.softwareUpdates.enabled) {
        return UpgradeStatus.make({
          status: 'disabled',
          currentVersion: active.current,
          detail: 'Automatic software updates are disabled.',
        });
      }
      const state = yield* readState();
      const now = yield* Clock.currentTimeMillis;
      if (
        state.lastCheckedAt !== undefined &&
        now - state.lastCheckedAt <
          intervalMilliseconds(config.softwareUpdates.checkInterval)
      ) {
        return UpgradeStatus.make({
          status: 'notDue',
          currentVersion: active.current,
          detail: 'The next stable-release check is not due yet.',
        });
      }
      return yield* withLock(
        Effect.gen(function* () {
          const lockedState = yield* readState();
          if (
            lockedState.lastCheckedAt !== undefined &&
            now - lockedState.lastCheckedAt <
              intervalMilliseconds(config.softwareUpdates.checkInterval)
          ) {
            return UpgradeStatus.make({
              status: 'notDue',
              currentVersion: (yield* readActive()).current,
              detail: 'Another check already recorded the current interval.',
            });
          }
          yield* storage.writeJson(
            statePath,
            SoftwareUpdateState.make({
              schemaVersion: 1,
              quarantined: lockedState.quarantined,
              lastError: lockedState.lastError,
              lastCheckedAt: now,
            }),
          );
          return yield* applyLatest();
        }),
      );
    });

    const normalize = <A, E>(operation: Effect.Effect<A, E>) =>
      operation.pipe(
        Effect.mapError((error) =>
          error instanceof UpgradeError
            ? error
            : UpgradeError.make({
                operation: 'storage',
                reason:
                  'Software update state or files could not be read, validated, or restored. Inspect the installation before retrying.',
              }),
        ),
      );
    const recordAutomaticFailure = Effect.fn('Upgrades.recordAutomaticFailure')(
      function* (error: UpgradeError) {
        const now = yield* Clock.currentTimeMillis;
        const state = yield* readState();
        yield* storage.writeJson(
          statePath,
          SoftwareUpdateState.make({
            schemaVersion: 1,
            quarantined: state.quarantined,
            lastCheckedAt: state.lastCheckedAt,
            lastError: error.reason,
          }),
        );
        yield* storage.appendEvent(
          paths.events,
          HarnessEvent.make({
            schemaVersion: 1,
            timestamp: new Date(now).toISOString(),
            type: 'software-update.failed',
            details: { operation: error.operation, reason: error.reason },
          }),
        );
      },
    );
    return {
      recover: () => normalize(recover()),
      status: () => normalize(status()),
      check: () =>
        normalize(inspect().pipe(Effect.map((result) => result.status))),
      apply: () => normalize(withLock(applyLatest())),
      rollback: (dryRun?: boolean) => normalize(rollback(dryRun ?? false)),
      checkIfDue: () =>
        normalize(checkIfDue()).pipe(
          Effect.tapError((error) =>
            recordAutomaticFailure(error).pipe(Effect.ignore),
          ),
        ),
    } satisfies UpgradesService;
  }).pipe(Effect.withSpan('upgradesLayer')),
);

function intervalMilliseconds(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  return (
    (Number(match?.[1] ?? 0) * 3600 +
      Number(match?.[2] ?? 0) * 60 +
      Number(match?.[3] ?? 0)) *
    1000
  );
}
/**
 * Compares already validated stable versions without lexical ordering mistakes.
 * @param candidate Release offered by the fixed GitHub feed.
 * @param current Installed release to retain unless a later version is offered.
 * @returns Whether the candidate is strictly newer than the current version.
 */
function newerVersion(candidate: string, current: string): boolean {
  const candidateParts = candidate.split('.').map(Number);
  const currentParts = current.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference =
      (candidateParts[index] ?? 0) - (currentParts[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}
