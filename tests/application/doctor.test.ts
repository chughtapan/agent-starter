/**
 * @file Checks setup diagnostics through the exported doctor command.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Stdio from 'effect/Stdio';
import { FastCheck } from 'effect/testing';
import * as TestConsole from 'effect/testing/TestConsole';
import * as Command from 'effect/unstable/cli/Command';

import { doctorCommand } from '../../src/application/commands/index.js';
import { Mailbox } from '../../src/collaboration/mail/index.js';
import { makeDefaultConfig } from '../../src/domain/configuration.js';
import { AdapterProbe } from '../../src/domain/runtime.js';
import { UpgradeStatus } from '../../src/domain/upgrades.js';
import { Adapters, Scheduler } from '../../src/hosts/index.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';
import { Upgrades } from '../../src/upgrades/index.js';

const HOST_REPORT = Schema.fromJsonString(
  Schema.Struct({
    hosts: Schema.Struct({ ok: Schema.Boolean }),
  }),
);

const runDoctor = Effect.fn('test.runDoctor')(function* (
  hosts: readonly AdapterProbe[],
) {
  const dependencies = Layer.mergeAll(
    pathsLayer.pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: '/fixture' })),
      ),
    ),
    Layer.mock(Configuration)({
      load: () => Effect.succeed(makeDefaultConfig()),
    }),
    Layer.mock(Mailbox)({ verifyConnection: () => Effect.succeed('verified') }),
    Layer.mock(Adapters)({ detect: () => Effect.succeed(hosts) }),
    Layer.mock(Scheduler)({
      status: () =>
        Effect.succeed({
          installed: true,
          mechanism: 'manual',
          detail: 'fixture',
        }),
    }),
    Layer.mock(Upgrades)({
      status: () =>
        Effect.succeed(
          UpgradeStatus.make({
            status: 'current',
            currentVersion: '0.5.0',
            detail: 'fixture',
          }),
        ),
    }),
    Layer.mock(Storage)({
      readJson: () =>
        Effect.succeed({
          schemaVersion: 1,
          lastSync: '2026-09-12T00:00:00.000Z',
          updates: [],
        }),
    }),
  );
  return yield* Effect.gen(function* () {
    const outcome = yield* Command.runWith(doctorCommand, { version: '0.0.0' })(
      ['--json'],
    ).pipe(Effect.result);
    const lines = yield* TestConsole.logLines;
    const report = yield* Schema.decodeUnknownEffect(HOST_REPORT)(lines[0]);
    return { outcome, report };
  }).pipe(
    Effect.provide(dependencies),
    Effect.provide(Layer.fresh(TestConsole.layer)),
    Effect.provide(Stdio.layerTest({})),
    Effect.provide(NodeServices.layer),
  );
});

describe('host setup diagnostics', () => {
  it('requires at least one working supported host', () =>
    Effect.gen(function* () {
      const healthy = yield* runDoctor([
        AdapterProbe.make({
          name: 'claude',
          detected: true,
          compatible: true,
          installed: true,
        }),
      ]);
      assert.isTrue(healthy.report.hosts.ok);
      assert.strictEqual(healthy.outcome._tag, 'Success');
      const absent = yield* runDoctor([]);
      assert.isFalse(absent.report.hosts.ok);
      assert.strictEqual(absent.outcome._tag, 'Failure');
    }).pipe(Effect.runPromise));

  it.effect.prop(
    'absent or disabled hosts never count as usable installation evidence',
    [
      FastCheck.array(
        FastCheck.record({
          detected: FastCheck.boolean(),
          installed: FastCheck.boolean(),
        }),
        { maxLength: 3 },
      ),
    ],
    ([probes]) =>
      Effect.gen(function* () {
        const result = yield* runDoctor(
          probes.map((probe) =>
            AdapterProbe.make({
              name: 'codex',
              compatible: false,
              ...probe,
            }),
          ),
        );
        assert.isFalse(result.report.hosts.ok);
        assert.strictEqual(result.outcome._tag, 'Failure');
      }),
    { fastCheck: { numRuns: 25 } },
  );

  it.effect(
    'an incomplete compatible host still fails the combined check',
    () =>
      Effect.gen(function* () {
        const result = yield* runDoctor([
          AdapterProbe.make({
            name: 'claude',
            detected: true,
            compatible: true,
            installed: true,
          }),
          AdapterProbe.make({
            name: 'codex',
            detected: true,
            compatible: true,
            installed: false,
          }),
        ]);
        assert.isFalse(result.report.hosts.ok);
        assert.strictEqual(result.outcome._tag, 'Failure');
      }),
  );
});
