/**
 * @file Verifies polling cadence and isolation from software update failures.
 */

import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';
import * as TestClock from 'effect/testing/TestClock';

import type { HarnessEvent } from '../../src/domain/runtime.js';

import { Poller, pollerLayer } from '../../src/application/polling/index.js';
import { Board } from '../../src/collaboration/presentation/index.js';
import {
  HarnessConfig,
  makeDefaultConfig,
} from '../../src/domain/configuration.js';
import { UpgradeError, UpgradeStatus } from '../../src/domain/upgrades.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';
import { Upgrades } from '../../src/upgrades/index.js';

const CURRENT = UpgradeStatus.make({
  status: 'current',
  currentVersion: '0.5.0',
  detail: 'The current stable version is active.',
});

const pollingFixture = Effect.fn('test.pollingFixture')(function* (
  interval: string,
  upgradeResult: Effect.Effect<UpgradeStatus, UpgradeError>,
) {
  const operations: string[] = [];
  const boardCalls: Array<Parameters<typeof Board.Service.check>> = [];
  const events: Array<{ path: string; event: HarnessEvent }> = [];
  const config = yield* Schema.decodeUnknownEffect(HarnessConfig)({
    ...Schema.encodeSync(HarnessConfig)(makeDefaultConfig()),
    polling: { interval },
  });
  const dependencies = Layer.mergeAll(
    Layer.mock(Configuration)({ load: () => Effect.succeed(config) }),
    pathsLayer.pipe(
      Layer.provide(Path.layer),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: '/unused' })),
      ),
    ),
    Layer.mock(Board)({
      check: (...args) =>
        Effect.sync(() => {
          operations.push('mailbox');
          boardCalls.push(args);
          return {
            updates: [],
            rendered: 'UPDATES\nALL CLEAR',
            shouldPresent: false,
            source: 'fresh',
            unpresentedMessageIds: [],
          };
        }),
    }),
    Layer.mock(Storage)({
      appendEvent: (path, event) =>
        Effect.sync(() => {
          operations.push('event');
          events.push({ path, event });
        }),
    }),
    Layer.mock(Upgrades)({
      checkIfDue: () =>
        Effect.sync(() => operations.push('upgrade')).pipe(
          Effect.andThen(upgradeResult),
        ),
    }),
  );
  const services = yield* Layer.build(
    pollerLayer.pipe(Layer.provide(dependencies)),
  );
  return {
    poller: Context.get(services, Poller),
    operations,
    boardCalls,
    events,
  };
});

describe('background polling', () => {
  it('one-shot polling refreshes without presenting and then checks updates', () =>
    Effect.gen(function* () {
      const { poller, operations, boardCalls, events } = yield* pollingFixture(
        'PT1M',
        Effect.succeed(CURRENT),
      );

      yield* poller.once();

      assert.deepEqual(operations, ['mailbox', 'event', 'upgrade']);
      assert.deepEqual(boardCalls, [[false, false]]);
      assert.lengthOf(events, 1);
      assert.strictEqual(
        events[0]?.path,
        '/unused/.social-harness/logs/events.jsonl',
      );
      assert.strictEqual(events[0]?.event.type, 'mailbox.polled');
      assert.deepEqual(events[0]?.event.details, {
        openUpdates: 0,
        source: 'fresh',
      });
    }).pipe(Effect.scoped, Effect.runPromise));

  it.effect.prop(
    'runs one initial poll and waits the configured interval before each repeat',
    [FastCheck.integer({ min: 1, max: 120 })],
    ([seconds]) =>
      Effect.gen(function* () {
        const { poller, operations, events } = yield* pollingFixture(
          `PT${String(seconds)}S`,
          Effect.succeed(CURRENT),
        );
        const fiber = yield* Effect.forkChild(poller.run());

        yield* TestClock.adjust(0);
        assert.deepEqual(operations, ['mailbox', 'event', 'upgrade']);
        yield* TestClock.adjust(seconds * 1000 - 1);
        assert.lengthOf(events, 1);
        yield* TestClock.adjust(1);
        assert.lengthOf(events, 2);
        yield* TestClock.adjust(seconds * 1000);
        assert.lengthOf(events, 3);
        yield* Fiber.interrupt(fiber);
      }),
    { fastCheck: { numRuns: 20 } },
  );

  it.effect(
    'keeps completed polls and continues scheduling when update checks fail',
    () =>
      Effect.gen(function* () {
        const { poller, operations, events } = yield* pollingFixture(
          'PT1M',
          Effect.fail(
            UpgradeError.make({
              operation: 'check',
              reason: 'release service unavailable',
            }),
          ),
        );
        yield* poller.once();
        assert.deepEqual(operations, ['mailbox', 'event', 'upgrade']);
        const fiber = yield* Effect.forkChild(poller.run());

        yield* TestClock.adjust(0);
        assert.lengthOf(events, 2);
        yield* TestClock.adjust('1 minute');
        assert.lengthOf(events, 3);
        assert.deepEqual(operations, [
          'mailbox',
          'event',
          'upgrade',
          'mailbox',
          'event',
          'upgrade',
          'mailbox',
          'event',
          'upgrade',
        ]);
        yield* Fiber.interrupt(fiber);
      }),
  );
});
