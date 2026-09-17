/**
 * @file Exercises scheduler isolation and owned resources without real launchd.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import { makeDefaultConfig } from '../../src/domain/configuration.js';
import { OwnershipManifest } from '../../src/domain/runtime.js';
import { Scheduler, schedulerLayer } from '../../src/hosts/index.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import { documentTemplatesLayer } from '../../src/platform/documents/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';

function schedulerFixture(environment: Readonly<Record<string, string>>) {
  const files = new Map<string, unknown>();
  const commands: string[] = [];
  let loaded = false;
  const spawner = Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
    string: (command) =>
      Effect.sync(() => {
        if (command._tag !== 'StandardCommand') {
          return '';
        }
        commands.push([command.command, ...command.args].join(' '));
        return command.command === 'uname' ? 'Darwin' : '501';
      }),
    exitCode: (command) =>
      Effect.sync(() => {
        if (command._tag !== 'StandardCommand') {
          return ChildProcessSpawner.ExitCode(1);
        }
        commands.push([command.command, ...command.args].join(' '));
        if (command.args[0] === 'bootstrap') {
          loaded = true;
        }
        if (command.args[0] === 'bootout') {
          loaded = false;
        }
        return ChildProcessSpawner.ExitCode(
          command.args[0] === 'print' && !loaded ? 1 : 0,
        );
      }),
  });
  const storage = Layer.mock(Storage)({
    readJson: (path) => Effect.sync(() => files.get(path)),
    readText: (path) =>
      Effect.sync(() => {
        const value = files.get(path);
        return typeof value === 'string' ? value : undefined;
      }),
    exists: (path) => Effect.sync(() => files.has(path)),
    writeText: (path, text) =>
      Effect.sync(() => {
        files.set(path, text);
      }),
    writeJson: (path, value) =>
      Effect.sync(() => {
        files.set(path, value);
      }),
  });
  const dependencies = Layer.mergeAll(
    pathsLayer,
    documentTemplatesLayer,
    spawner,
    storage,
    Layer.mock(Configuration)({
      load: () => Effect.succeed(makeDefaultConfig()),
    }),
  );
  const fixtureLayer = schedulerLayer.pipe(
    Layer.provide(dependencies),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown(
          { HOME: '/owner', ...environment },
          { preserveEmptyStrings: true },
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  return { files, commands, layer: fixtureLayer };
}

describe('safe scheduler installation', () => {
  it.effect.prop(
    'rejects arbitrary labels outside the test namespace before mutation',
    [
      FastCheck.string().filter(
        (value) =>
          !/^dev\.social-harness\.eval\.[a-z0-9][a-z0-9-]{0,63}$/.test(value),
      ),
    ],
    ([label]) => {
      const fixture = schedulerFixture({
        SOCIAL_HARNESS_SCHEDULER_MODE: 'launchd',
        SOCIAL_HARNESS_LAUNCHD_LABEL: label,
      });
      return Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const result = yield* scheduler.install().pipe(Effect.result);
        assert.strictEqual(result._tag, 'Failure');
        assert.deepEqual(fixture.commands, []);
        assert.strictEqual(fixture.files.size, 0);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect('manual mode performs no process or filesystem changes', () => {
    const fixture = schedulerFixture({
      SOCIAL_HARNESS_USER_HOME: '/test/owner',
      SOCIAL_HARNESS_SCHEDULER_MODE: 'manual',
    });
    return Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      assert.strictEqual((yield* scheduler.install()).mechanism, 'manual');
      assert.isFalse((yield* scheduler.status()).installed);
      assert.deepEqual(fixture.commands, []);
      assert.strictEqual(fixture.files.size, 0);
    }).pipe(Effect.provide(fixture.layer));
  });

  it.effect(
    'blocks isolated homes from replacing the production launchd label',
    () => {
      const fixture = schedulerFixture({
        SOCIAL_HARNESS_USER_HOME: '/test/owner',
        SOCIAL_HARNESS_SCHEDULER_MODE: 'launchd',
      });
      return Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const result = yield* scheduler.install().pipe(Effect.result);
        assert.strictEqual(result._tag, 'Failure');
        assert.deepEqual(fixture.commands, []);
        assert.strictEqual(fixture.files.size, 0);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect('rejects a label outside the dedicated eval namespace', () => {
    const fixture = schedulerFixture({
      SOCIAL_HARNESS_LAUNCHD_LABEL: 'other-product.poller',
      SOCIAL_HARNESS_SCHEDULER_MODE: 'launchd',
    });
    return Effect.gen(function* () {
      const scheduler = yield* Scheduler;
      assert.strictEqual(
        (yield* scheduler.install().pipe(Effect.result))._tag,
        'Failure',
      );
      assert.deepEqual(fixture.commands, []);
      assert.strictEqual(fixture.files.size, 0);
    }).pipe(Effect.provide(fixture.layer));
  });

  it.effect(
    'blocks production labels when the explicit isolated home equals child HOME',
    () => {
      const fixture = schedulerFixture({
        SOCIAL_HARNESS_USER_HOME: '/owner',
        SOCIAL_HARNESS_SCHEDULER_MODE: 'launchd',
      });
      return Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        assert.strictEqual(
          (yield* scheduler.install().pipe(Effect.result))._tag,
          'Failure',
        );
        assert.deepEqual(fixture.commands, []);
        assert.strictEqual(fixture.files.size, 0);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    'previews an eval job without changing launchd or owned files',
    () => {
      const fixture = schedulerFixture({
        SOCIAL_HARNESS_USER_HOME: '/test/owner',
        SOCIAL_HARNESS_SCHEDULER_MODE: 'launchd',
        SOCIAL_HARNESS_LAUNCHD_LABEL: 'dev.social-harness.eval.alice',
      });
      return Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        const result = yield* scheduler.install({ dryRun: true });
        assert.include(result.detail, 'dev.social-harness.eval.alice.plist');
        assert.isFalse(
          fixture.commands.some((command) => command.startsWith('launchctl')),
        );
        assert.strictEqual(fixture.files.size, 0);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    'records one eval job, binds its environment, and avoids duplicate reloads',
    () => {
      const fixture = schedulerFixture({
        SOCIAL_HARNESS_USER_HOME: '/test/owner',
        SOCIAL_HARNESS_SCHEDULER_MODE: 'launchd',
        SOCIAL_HARNESS_LAUNCHD_LABEL: 'dev.social-harness.eval.alice',
        SOCIAL_HARNESS_BOOTSTRAP: '/test/runtime/bootstrap.js',
      });
      return Effect.gen(function* () {
        const scheduler = yield* Scheduler;
        assert.isTrue((yield* scheduler.install()).installed);
        assert.isTrue((yield* scheduler.install()).installed);
        const plist = fixture.files.get(
          '/test/owner/Library/LaunchAgents/dev.social-harness.eval.alice.plist',
        );
        assert.isString(plist);
        if (typeof plist !== 'string') {
          return;
        }
        assert.include(plist, '/test/runtime/bootstrap.js');
        assert.include(
          plist,
          '<key>SOCIAL_HARNESS_HOME</key><string>/test/owner/.social-harness</string>',
        );
        assert.include(
          plist,
          '<key>AGENTMAIL_HOME</key><string>/test/owner/.agentmail</string>',
        );
        assert.include(
          plist,
          '<key>SOCIAL_HARNESS_USER_HOME</key><string>/test/owner</string>',
        );
        assert.strictEqual(
          fixture.commands.filter((command) =>
            command.startsWith('launchctl bootstrap'),
          ).length,
          1,
        );
        assert.isFalse(
          fixture.commands.some((command) =>
            command.includes('/dev.social-harness.poller'),
          ),
        );
        const manifest = yield* Schema.decodeUnknownEffect(OwnershipManifest)(
          fixture.files.get('/test/owner/.social-harness/state/ownership.json'),
        );
        assert.strictEqual(manifest.entries.length, 1);
        assert.strictEqual(
          manifest.entries[0]?.identifier,
          'dev.social-harness.eval.alice',
        );
      }).pipe(Effect.provide(fixture.layer));
    },
  );
});
