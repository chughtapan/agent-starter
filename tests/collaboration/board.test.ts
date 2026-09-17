/**
 * @file Verifies the compact, session-free collaboration board contract.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it, layer } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Context from 'effect/Context';
import * as Deferred from 'effect/Deferred';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import { FastCheck } from 'effect/testing';
import * as TestClock from 'effect/testing/TestClock';

import { Mailbox, MailboxError } from '../../src/collaboration/mail/index.js';
import {
  Board,
  boardLayer,
  receiptsLayer,
  renderBoard,
} from '../../src/collaboration/presentation/index.js';
import {
  CollaborationUpdate,
  MailboxCache,
} from '../../src/domain/collaboration.js';
import { makeDefaultConfig } from '../../src/domain/configuration.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import {
  Paths,
  pathsLayer,
  Storage,
  storageLayer,
} from '../../src/platform/persistence/index.js';

const OFFLINE = MailboxError.make({
  operation: 'sync',
  reason: 'mailbox service unavailable',
});

const boardFixture = Effect.fn('test.boardFixture')(function* (
  sync: Effect.Effect<readonly CollaborationUpdate[], MailboxError>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const home = yield* fileSystem.makeTempDirectoryScoped({
    prefix: 'social-harness-board-test-',
  });
  const dependencies = Layer.mergeAll(
    pathsLayer,
    storageLayer,
    Layer.mock(Configuration)({
      load: () => Effect.succeed(makeDefaultConfig()),
    }),
    Layer.mock(Mailbox)({ syncUpdates: () => sync }),
  );
  const services = yield* Layer.build(
    boardLayer.pipe(
      Layer.provideMerge(receiptsLayer.pipe(Layer.provideMerge(dependencies))),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: home })),
      ),
    ),
  );
  return {
    board: Context.get(services, Board),
    paths: Context.get(services, Paths),
    storage: Context.get(services, Storage),
  };
});

describe('update board', () => {
  it('shows collaboration state without sessions', () => {
    const now = Date.parse('2026-08-27T18:00:00.000Z');
    const output = renderBoard(
      [
        CollaborationUpdate.make({
          threadId: 'thread-1',
          messageId: 'message-1',
          kind: 'needsYou',
          collaborator: 'Alice <alice@example.com>',
          summary: 'dataset-access decision',
          updatedAt: '2026-08-27T17:59:00.000Z',
          labels: ['sh-needs-you', 'unread'],
          unread: true,
          subject: 'Dataset access',
        }),
        CollaborationUpdate.make({
          threadId: 'thread-2',
          messageId: 'message-2',
          kind: 'waiting',
          collaborator: 'carol@example.com',
          summary: 'API example',
          updatedAt: '2026-08-27T17:28:00.000Z',
          labels: ['sh-waiting'],
          unread: false,
          subject: 'API example',
        }),
      ],
      now,
    );

    assert.include(output, 'NEEDS YOU Alice · dataset-access decision');
    assert.include(output, 'WAITING   carol · API example · 32m');
    assert.notInclude(output.toLowerCase(), 'session');
  });

  it('has an explicit empty state', () => {
    assert.strictEqual(renderBoard([], 0), 'UPDATES\nALL CLEAR');
  });

  it('uses the inbox name when the transport display name is generic', () => {
    const output = renderBoard(
      [
        CollaborationUpdate.make({
          threadId: 'thread-intro',
          messageId: 'message-intro',
          kind: 'ready',
          collaborator: 'AgentMail <bob-agent@agentmail.to>',
          summary: 'Welcome, alice-agent.',
          updatedAt: '2026-08-27T18:00:00.000Z',
          labels: ['sh-ready', 'unread'],
          unread: true,
          subject: 'Re: [INTRO] alice-agent for Alice Adams',
        }),
      ],
      Date.parse('2026-08-27T18:01:00.000Z'),
    );

    assert.include(output, 'READY     bob-agent · Welcome, alice-agent.');
  });
});

layer(NodeServices.layer)('unavailable mailbox', (it) => {
  it.effect.prop(
    'preserves cached results and their sync time when mailbox refresh fails',
    [FastCheck.string({ minLength: 1, maxLength: 80 })],
    ([summary]) =>
      Effect.gen(function* () {
        const { board, paths, storage } = yield* boardFixture(
          Effect.fail(OFFLINE),
        );
        const cached = MailboxCache.make({
          schemaVersion: 1,
          lastSync: '2026-09-12T00:00:00.000Z',
          updates: [cachedUpdate(summary)],
        });
        yield* storage.writeJson(paths.cache, cached);
        const savedCache = yield* storage.readText(paths.cache);

        const result = yield* board.check();

        assert.strictEqual(result.source, 'cache');
        assert.strictEqual(result.warning, 'mailbox service unavailable');
        assert.deepEqual(result.updates, cached.updates);
        assert.deepEqual(result.unpresentedMessageIds, ['message-result']);
        assert.match(result.rendered, /^UPDATES\nREADY/);
        assert.strictEqual(yield* storage.readText(paths.cache), savedCache);
      }),
    { fastCheck: { numRuns: 25 } },
  );

  it.effect(
    'reports unavailable instead of all clear without a cached snapshot',
    () =>
      Effect.gen(function* () {
        const { board, paths, storage } = yield* boardFixture(
          Effect.fail(OFFLINE),
        );

        const result = yield* board.check();

        assert.strictEqual(result.rendered, 'UPDATES\nUNAVAILABLE');
        assert.strictEqual(result.source, 'cache');
        assert.strictEqual(result.warning, 'mailbox service unavailable');
        assert.isTrue(result.shouldPresent);
        assert.deepEqual(result.updates, []);
        assert.isUndefined(yield* storage.readJson(paths.cache));
      }),
  );

  it.effect(
    'returns cached updates after the five-second mailbox deadline',
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<boolean>();
        const completed = yield* Deferred.make<boolean>();
        const sync = Deferred.succeed(started, true).pipe(
          Effect.andThen(Effect.never),
        );
        const { board, paths, storage } = yield* boardFixture(sync);
        const update = cachedUpdate('Research result');
        const cached = MailboxCache.make({
          schemaVersion: 1,
          lastSync: '2026-09-12T00:00:00.000Z',
          updates: [update],
        });
        yield* storage.writeJson(paths.cache, cached);
        const savedCache = yield* storage.readText(paths.cache);
        const fiber = yield* Effect.forkChild(
          board
            .check()
            .pipe(Effect.tap(() => Deferred.succeed(completed, true))),
        );
        yield* Deferred.await(started);

        yield* TestClock.adjust('4999 millis');
        assert.isFalse(yield* Deferred.isDone(completed));
        yield* TestClock.adjust('1 milli');
        const result = yield* Fiber.join(fiber);

        assert.strictEqual(result.source, 'cache');
        assert.strictEqual(result.warning, 'mailbox check timed out');
        assert.deepEqual(result.updates, [update]);
        assert.include(result.rendered, 'READY     Alice · Research result');
        assert.strictEqual(yield* storage.readText(paths.cache), savedCache);
      }),
  );
});

function cachedUpdate(summary: string): CollaborationUpdate {
  return CollaborationUpdate.make({
    threadId: 'thread-result',
    messageId: 'message-result',
    kind: 'ready',
    collaborator: 'Alice',
    summary,
    updatedAt: '2026-09-12T00:00:00.000Z',
    labels: ['sh-ready', 'unread'],
    unread: true,
    subject: '[COLLAB] Research result',
  });
}
