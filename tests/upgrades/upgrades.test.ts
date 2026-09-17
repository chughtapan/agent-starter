/**
 * @file Exercises software update activation and recovery in private temporary homes.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';
import * as TestClock from 'effect/testing/TestClock';

import {
  HarnessConfig,
  makeDefaultConfig,
} from '../../src/domain/configuration.js';
import {
  ActivationJournal,
  ActiveRelease,
  ReleaseManifest,
  SoftwareUpdateState,
  UpgradeError,
} from '../../src/domain/upgrades.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import {
  Paths,
  pathsLayer,
  Storage,
  storageLayer,
} from '../../src/platform/persistence/index.js';
import {
  ReleasePackages,
  Upgrades,
  upgradesLayer,
} from '../../src/upgrades/index.js';

const RELEASE = ReleaseManifest.make({
  schemaVersion: 1,
  repository: 'chughtapan/agent-starter',
  version: '0.5.0',
  file: 'social-harness-0.5.0.tgz',
  sha256: 'a'.repeat(64),
});

describe('stable software updates', () => {
  it.effect(
    'automatically activates an eligible release when the existing poller calls',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-upgrade-test-',
        });
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          assert.strictEqual((yield* upgrades.checkIfDue()).status, 'updated');
          assert.strictEqual((yield* upgrades.checkIfDue()).status, 'notDue');
          assert.strictEqual(
            (yield* upgrades.status()).currentVersion,
            '0.5.0',
          );
        }).pipe(Effect.provide(fixtureLayer(directory, normalPackages())));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect.prop(
    'never downgrades or reinstalls an equal stable version',
    [
      FastCheck.tuple(
        FastCheck.nat({ max: 1000 }),
        FastCheck.nat({ max: 1000 }),
        FastCheck.nat({ max: 1000 }),
      ),
    ],
    ([parts]) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-version-test-',
        });
        const [major, minor, patch] = parts;
        const current = `${String(major)}.${String(minor)}.${String(patch)}`;
        const next = `${String(major)}.${String(minor)}.${String(patch + 1)}`;
        const cases = [
          { installed: current, offered: current, status: 'current' },
          { installed: current, offered: next, status: 'available' },
          { installed: next, offered: current, status: 'current' },
        ];
        yield* Effect.forEach(
          cases,
          ({ installed, offered, status }) => {
            const release = ReleaseManifest.make({
              schemaVersion: 1,
              repository: 'chughtapan/agent-starter',
              version: offered,
              file: `social-harness-${offered}.tgz`,
              sha256: 'a'.repeat(64),
            });
            const packages = {
              ...normalPackages(),
              runningVersion: () => Effect.succeed(installed),
              latest: () => Effect.succeed(release),
            };
            return Effect.gen(function* () {
              const upgrades = yield* Upgrades;
              assert.strictEqual((yield* upgrades.check()).status, status);
            }).pipe(Effect.provide(fixtureLayer(directory, packages)));
          },
          { concurrency: 1 },
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    { fastCheck: { numRuns: 25 } },
  );
  it('defaults older configuration to daily automatic checks', () => {
    const { softwareUpdates, ...olderConfig } = makeDefaultConfig();
    const decoded = Schema.decodeUnknownSync(HarnessConfig)(olderConfig);
    assert.deepEqual(decoded.softwareUpdates, softwareUpdates);
  });

  it.effect(
    'checks without writing and activates a staged release before allowing rollback',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-upgrade-test-',
        });
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          assert.strictEqual((yield* upgrades.check()).status, 'available');
          assert.isFalse(yield* storage.exists(paths.runtime));
          assert.strictEqual((yield* upgrades.apply()).status, 'updated');
          assert.isFalse(
            yield* storage.exists(`${paths.runtime}/activation-journal.json`),
          );
          const active = yield* Schema.decodeUnknownEffect(ActiveRelease)(
            yield* storage.readJson(`${paths.runtime}/active-release.json`),
          );
          assert.strictEqual(active.current, '0.5.0');
          assert.strictEqual(
            (yield* upgrades.rollback(true)).candidateVersion,
            '0.4.0',
          );
          assert.strictEqual((yield* upgrades.rollback()).status, 'rolledBack');
          assert.isFalse(
            yield* storage.exists(`${paths.runtime}/activation-journal.json`),
          );
          assert.strictEqual((yield* upgrades.check()).status, 'quarantined');
        }).pipe(Effect.provide(fixtureLayer(directory, normalPackages())));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'quarantines failed staging and keeps the current executable selection',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-upgrade-test-',
        });
        const packages = {
          ...normalPackages(),
          stage: () =>
            Effect.fail(
              UpgradeError.make({
                operation: 'checksum',
                reason: 'checksum mismatch',
              }),
            ),
        };
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          const failed = yield* upgrades.apply().pipe(Effect.result);
          assert.strictEqual(failed._tag, 'Failure');
          assert.isUndefined(
            yield* storage.readJson(`${paths.runtime}/active-release.json`),
          );
          assert.strictEqual((yield* upgrades.apply()).status, 'quarantined');
          assert.isFalse(
            yield* storage.exists(`${paths.runtime}/upgrade.lock`),
          );
        }).pipe(Effect.provide(fixtureLayer(directory, packages)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'restores existing settings and removes newly created skills after failed repair',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-upgrade-test-',
        });
        const settings = `${directory}/.claude/settings.json`;
        const newSkill = `${directory}/.agents/skills/social-harness/SKILL.md`;
        yield* fileSystem.makeDirectory(`${directory}/.claude`, {
          recursive: true,
        });
        yield* fileSystem.writeFileString(
          settings,
          '{"unrelated":"preserve me"}\n',
        );
        yield* fileSystem.chmod(settings, 0o640);
        const failedRepair = Effect.fn('test.failedRepairBoundary')(
          function* () {
            yield* fileSystem.writeFileString(settings, '{"changed":true}');
            yield* fileSystem.makeDirectory(
              `${directory}/.agents/skills/social-harness`,
              { recursive: true },
            );
            yield* fileSystem.writeFileString(
              newSkill,
              'incomplete candidate skill',
            );
            return yield* Effect.fail(
              UpgradeError.make({
                operation: 'repair',
                reason: 'injected repair failure',
              }),
            );
          },
        );
        const packageBoundary = {
          ...normalPackages(),
          repair: () =>
            failedRepair().pipe(
              Effect.mapError(() =>
                UpgradeError.make({
                  operation: 'repair',
                  reason: 'injected repair failure',
                }),
              ),
            ),
        };
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const storage = yield* Storage;
          const result = yield* upgrades.apply().pipe(Effect.result);
          assert.strictEqual(result._tag, 'Failure');
          assert.strictEqual(
            yield* storage.readText(settings),
            '{"unrelated":"preserve me"}\n',
          );
          assert.isFalse(yield* storage.exists(newSkill));
          assert.strictEqual(
            (yield* fileSystem.stat(settings)).mode & 0o777,
            0o640,
          );
          assert.strictEqual(
            (yield* upgrades.status()).currentVersion,
            '0.4.0',
          );
        }).pipe(Effect.provide(fixtureLayer(directory, packageBoundary)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'recovers interrupted repair from persisted files in a fresh service instance',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-interrupted-upgrade-',
        });
        const settings = `${directory}/.claude/settings.json`;
        const newSkill = `${directory}/.agents/skills/social-harness/SKILL.md`;
        const original = '{"ownerSetting":"retain this value"}\n';
        yield* fileSystem.makeDirectory(`${directory}/.claude`, {
          recursive: true,
        });
        yield* fileSystem.writeFileString(settings, original);
        yield* fileSystem.chmod(settings, 0o640);
        const repairStarted = yield* Deferred.make<boolean>();
        const interruptedRepair = Effect.fn('test.interruptedRepair')(
          function* () {
            yield* fileSystem.writeFileString(settings, '{"partial":true}');
            yield* fileSystem.makeDirectory(
              `${directory}/.agents/skills/social-harness`,
              { recursive: true },
            );
            yield* fileSystem.writeFileString(newSkill, 'partial skill');
            yield* Deferred.succeed(repairStarted, true);
            yield* Effect.never;
          },
        );
        const packages = {
          ...normalPackages(),
          repair: () =>
            interruptedRepair().pipe(
              Effect.mapError(() =>
                UpgradeError.make({
                  operation: 'repair',
                  reason: 'injected filesystem failure',
                }),
              ),
            ),
        };
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          const worker = yield* upgrades.apply().pipe(Effect.forkChild);
          yield* Deferred.await(repairStarted);
          // Recovery cannot race the updater that still owns the lock.
          assert.strictEqual(
            (yield* upgrades.recover().pipe(Effect.result))._tag,
            'Failure',
          );
          yield* Fiber.interrupt(worker);
          const journal = yield* Schema.decodeUnknownEffect(ActivationJournal)(
            yield* storage.readJson(`${paths.runtime}/activation-journal.json`),
          );
          assert.strictEqual(journal.previous.current, '0.4.0');
          assert.strictEqual(journal.next.current, RELEASE.version);
          assert.isFalse(
            yield* storage.exists(`${paths.runtime}/upgrade.lock`),
          );
        }).pipe(Effect.provide(fixtureLayer(directory, packages)));
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          const recovery = yield* upgrades.recover();
          assert.strictEqual(recovery?.currentVersion, '0.4.0');
          assert.strictEqual(yield* storage.readText(settings), original);
          assert.strictEqual(
            (yield* fileSystem.stat(settings)).mode & 0o777,
            0o640,
          );
          assert.isFalse(yield* storage.exists(newSkill));
          assert.isFalse(
            yield* storage.exists(`${paths.runtime}/activation-journal.json`),
          );
          assert.strictEqual((yield* upgrades.check()).status, 'quarantined');
          assert.isUndefined(yield* upgrades.recover());
        }).pipe(Effect.provide(fixtureLayer(directory, normalPackages())));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'retains the journal when restoration fails and retries it without losing snapshots',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-recovery-retry-',
        });
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          const blockedPath = `${paths.claudeHome}/settings.json`;
          const journalPath = `${paths.runtime}/activation-journal.json`;
          const previous = ActiveRelease.make({
            schemaVersion: 1,
            baseline: '0.4.0',
            current: '0.4.0',
          });
          const next = ActiveRelease.make({
            schemaVersion: 1,
            baseline: '0.4.0',
            current: RELEASE.version,
          });
          const journal = ActivationJournal.make({
            schemaVersion: 1,
            operation: 'activate',
            previous,
            next,
            snapshots: [
              {
                path: blockedPath,
                content: '{"preserved":true}\n',
                mode: 0o600,
              },
            ],
          });
          yield* storage.writeJson(
            `${paths.runtime}/active-release.json`,
            next,
          );
          yield* storage.writeJson(journalPath, journal);
          yield* fileSystem.makeDirectory(blockedPath, { recursive: true });
          assert.strictEqual(
            (yield* upgrades.recover().pipe(Effect.result))._tag,
            'Failure',
          );
          assert.isTrue(yield* storage.exists(journalPath));
          assert.strictEqual(
            (yield* upgrades.status()).currentVersion,
            RELEASE.version,
          );
          yield* fileSystem.remove(blockedPath, { recursive: true });
          assert.strictEqual(
            (yield* upgrades.recover())?.currentVersion,
            previous.current,
          );
          assert.strictEqual(
            yield* storage.readText(blockedPath),
            '{"preserved":true}\n',
          );
          assert.isFalse(yield* storage.exists(journalPath));
        }).pipe(Effect.provide(fixtureLayer(directory, normalPackages())));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'records automatic lookup failures for diagnosis without changing the active release',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-upgrade-test-',
        });
        const packages = {
          ...normalPackages(),
          latest: () =>
            Effect.fail(
              UpgradeError.make({
                operation: 'check',
                reason: 'GitHub lookup is unavailable.',
              }),
            ),
        };
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          const result = yield* upgrades.checkIfDue().pipe(Effect.result);
          assert.strictEqual(result._tag, 'Failure');
          assert.strictEqual(
            (yield* upgrades.status()).currentVersion,
            '0.4.0',
          );
          const state = yield* Schema.decodeUnknownEffect(SoftwareUpdateState)(
            yield* storage.readJson(`${paths.state}/software-updates.json`),
          );
          assert.strictEqual(state.lastError, 'GitHub lookup is unavailable.');
          assert.include(
            yield* storage.readText(paths.events),
            'software-update.failed',
          );
          assert.strictEqual((yield* upgrades.checkIfDue()).status, 'notDue');
        }).pipe(Effect.provide(fixtureLayer(directory, packages)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'uses the existing poll cadence for daily checks and honors disabling',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-upgrade-test-',
        });
        const packages = {
          ...normalPackages(),
          latest: () => Effect.succeed(undefined),
        };
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          const paths = yield* Paths;
          const storage = yield* Storage;
          assert.strictEqual(
            (yield* upgrades.checkIfDue()).status,
            'noRelease',
          );
          assert.strictEqual((yield* upgrades.checkIfDue()).status, 'notDue');
          yield* TestClock.adjust('24 hours');
          assert.strictEqual(
            (yield* upgrades.checkIfDue()).status,
            'noRelease',
          );
          const state = yield* Schema.decodeUnknownEffect(SoftwareUpdateState)(
            yield* storage.readJson(`${paths.state}/software-updates.json`),
          );
          assert.isDefined(state.lastCheckedAt);
        }).pipe(Effect.provide(fixtureLayer(directory, packages)));
        const defaults =
          yield* Schema.encodeEffect(HarnessConfig)(makeDefaultConfig());
        const disabled = yield* Schema.decodeUnknownEffect(HarnessConfig)({
          ...defaults,
          softwareUpdates: { enabled: false, checkInterval: 'PT24H' },
        });
        yield* Effect.gen(function* () {
          const upgrades = yield* Upgrades;
          assert.strictEqual((yield* upgrades.checkIfDue()).status, 'disabled');
        }).pipe(Effect.provide(fixtureLayer(directory, packages, disabled)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

function normalPackages(): typeof ReleasePackages.Service {
  return {
    runningVersion: () => Effect.succeed('0.4.0'),
    latest: () => Effect.succeed(RELEASE),
    stage: () => Effect.succeed('staged'),
    verify: () => Effect.void,
    repair: () => Effect.void,
  };
}

function fixtureLayer(
  directory: string,
  packages: typeof ReleasePackages.Service,
  config?: HarnessConfig,
) {
  const effectiveConfig = config ?? makeDefaultConfig();
  const persistence = Layer.mergeAll(pathsLayer, storageLayer).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: directory })),
    ),
  );
  return upgradesLayer.pipe(
    Layer.provideMerge(Layer.succeed(ReleasePackages)(packages)),
    Layer.provideMerge(
      Layer.succeed(Configuration)({
        load: () => Effect.succeed(effectiveConfig),
        save: () => Effect.void,
      }),
    ),
    Layer.provideMerge(persistence),
  );
}
