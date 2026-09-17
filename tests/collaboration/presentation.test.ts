/**
 * @file Exercises durable visibility policy with real temporary persistence.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as TestClock from 'effect/testing/TestClock';
import { createHash } from 'node:crypto';

import { Mailbox } from '../../src/collaboration/mail/index.js';
import {
  Board,
  boardLayer,
  Receipts,
  receiptsLayer,
} from '../../src/collaboration/presentation/index.js';
import { CollaborationUpdate } from '../../src/domain/collaboration.js';
import { makeDefaultConfig } from '../../src/domain/configuration.js';
import { PresentationState } from '../../src/domain/presentation.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import {
  pathsLayer,
  Storage,
  storageLayer,
} from '../../src/platform/persistence/index.js';

const UPDATE = CollaborationUpdate.make({
  threadId: 'thread-bob',
  messageId: 'reply-bob',
  kind: 'ready',
  collaborator: 'Bob',
  summary: 'Retry failure trace',
  updatedAt: '2026-09-12T00:00:00.000Z',
  labels: ['unread'],
  unread: true,
  subject: '[COLLAB] Retry failure trace',
});
const SECOND_UPDATE = CollaborationUpdate.make({
  threadId: 'thread-carol',
  messageId: 'reply-carol',
  collaborator: 'Carol',
  kind: 'ready',
  summary: 'Retry failure trace',
  updatedAt: '2026-09-12T00:00:00.000Z',
  labels: ['unread'],
  unread: true,
  subject: '[COLLAB] Retry failure trace',
});

const presentationFixture = Effect.fn('test.presentationFixture')(function* (
  updates: readonly CollaborationUpdate[] = [UPDATE],
) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* fs.makeTempDirectoryScoped({
    prefix: 'social-harness-presentation-test-',
  });
  const calls: string[][] = [];
  const dependencies = Layer.mergeAll(
    pathsLayer,
    storageLayer,
    Layer.mock(Configuration)({
      load: () => Effect.succeed(makeDefaultConfig()),
    }),
    Layer.mock(Mailbox)({
      syncUpdates: () => Effect.succeed(updates),
      listUpdates: () => Effect.succeed(updates),
      markPresented: (ids) =>
        Effect.sync(() => {
          calls.push([...ids]);
        }),
    }),
  );
  const application = boardLayer.pipe(
    Layer.provideMerge(receiptsLayer.pipe(Layer.provideMerge(dependencies))),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          HOME: home,
          SOCIAL_HARNESS_USER_HOME: home,
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const services = yield* Layer.build(application);
  return {
    state: `${home}/.social-harness/state`,
    board: Context.get(services, Board),
    receipts: Context.get(services, Receipts),
    storage: Context.get(services, Storage),
    calls,
    application,
  };
});

describe('visible presentation', () => {
  it.effect('retrieving an update twice cannot consume its presentation', () =>
    Effect.gen(function* () {
      const { board } = yield* presentationFixture();
      assert.isTrue((yield* board.check()).shouldPresent);
      assert.isTrue((yield* board.check()).shouldPresent);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect('only an explicit visible-result receipt quiets the board', () =>
    Effect.gen(function* () {
      const { board, receipts } = yield* presentationFixture();
      const result = yield* board.check();
      assert.isDefined(result.receipt);
      yield* receipts.acknowledge(result.receipt ?? '', []);
      assert.isTrue((yield* board.check()).shouldPresent);
      yield* receipts.acknowledge(result.receipt ?? '', [UPDATE.messageId]);
      assert.isFalse((yield* board.check()).shouldPresent);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'an acknowledgement cannot consume a message outside its snapshot',
    () =>
      Effect.gen(function* () {
        const { board, receipts, calls } = yield* presentationFixture();
        const result = yield* board.check();
        const outcome = yield* receipts
          .acknowledge(result.receipt ?? '', ['later-reply'])
          .pipe(Effect.result);
        assert.strictEqual(outcome._tag, 'Failure');
        assert.deepEqual(calls, []);
        assert.isUndefined(yield* receipts.read());
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'orders snapshots by issue time even when both predate acknowledgements',
    () =>
      Effect.gen(function* () {
        const { receipts } = yield* presentationFixture([
          UPDATE,
          SECOND_UPDATE,
        ]);
        yield* TestClock.setTime(1_000);
        const first = yield* receipts.issue('first snapshot', [
          UPDATE.messageId,
        ]);
        yield* TestClock.setTime(2_000);
        const second = yield* receipts.issue('second snapshot', [
          SECOND_UPDATE.messageId,
        ]);
        yield* TestClock.setTime(3_000);
        yield* receipts.acknowledge(first, [UPDATE.messageId]);
        yield* TestClock.setTime(4_000);
        yield* receipts.acknowledge(second, [SECOND_UPDATE.messageId]);
        yield* TestClock.setTime(5_000);
        yield* receipts.acknowledge(first, []);
        const visible = yield* receipts.read();
        assert.equal(visible?.lastSignature, 'second snapshot');
        assert.equal(visible?.lastPresentedAt, '1970-01-01T00:00:04.000Z');
        assert.sameMembers(
          [...(visible?.visibleMessageIds ?? [])],
          ['reply-bob', 'reply-carol'],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'preserves concurrent host acknowledgements after rebuilding the service',
    () =>
      Effect.gen(function* () {
        const fixture = yield* presentationFixture([UPDATE, SECOND_UPDATE]);
        const independent = yield* Receipts.pipe(
          Effect.provide(fixture.application),
        );
        yield* TestClock.setTime(1_000);
        const first = yield* fixture.receipts.issue(
          'first snapshot',
          [UPDATE.messageId],
          'UPDATES\nREADY Bob',
        );
        yield* TestClock.setTime(2_000);
        const second = yield* independent.issue(
          'second snapshot',
          [SECOND_UPDATE.messageId],
          'UPDATES\nREADY Carol',
        );
        const firstDraft =
          'UPDATES\nREADY Bob\n\nBob found the failing retry trace.';
        const secondDraft =
          'UPDATES\nREADY Carol\n\nCarol reproduced the retry failure.';
        yield* fixture.receipts.prepare(first, 'claude', firstDraft, [
          UPDATE.messageId,
        ]);
        yield* independent.prepare(second, 'codex', secondDraft, [
          SECOND_UPDATE.messageId,
        ]);
        yield* TestClock.setTime(3_000);
        yield* Effect.all(
          [
            fixture.receipts.confirm('claude', firstDraft),
            independent.confirm('codex', secondDraft),
          ],
          { concurrency: 2 },
        );
        const restarted = yield* Receipts.pipe(
          Effect.provide(fixture.application),
        );
        const visible = yield* restarted.read();
        assert.sameMembers(
          [...(visible?.visibleMessageIds ?? [])],
          ['reply-bob', 'reply-carol'],
        );
        assert.equal(visible?.lastSignature, 'second snapshot');
        assert.lengthOf(
          yield* fixture.storage.listDirectory(
            `${fixture.state}/acknowledgements`,
          ),
          2,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'retries an identical acknowledgement without refreshing time or remote labels',
    () =>
      Effect.gen(function* () {
        const { receipts, calls, storage, state } = yield* presentationFixture([
          UPDATE,
          SECOND_UPDATE,
        ]);
        const receipt = yield* receipts.issue('snapshot', [
          UPDATE.messageId,
          SECOND_UPDATE.messageId,
        ]);
        yield* TestClock.setTime(1_000);
        yield* receipts.acknowledge(receipt, [
          UPDATE.messageId,
          SECOND_UPDATE.messageId,
        ]);
        yield* TestClock.setTime(2_000);
        yield* Effect.all(
          [
            receipts.acknowledge(receipt, [
              SECOND_UPDATE.messageId,
              UPDATE.messageId,
            ]),
            receipts.acknowledge(receipt, [
              UPDATE.messageId,
              UPDATE.messageId,
              SECOND_UPDATE.messageId,
            ]),
          ],
          { concurrency: 2 },
        );
        assert.equal(
          (yield* receipts.read())?.lastPresentedAt,
          '1970-01-01T00:00:01.000Z',
        );
        assert.lengthOf(calls, 1);
        assert.lengthOf(
          yield* storage.listDirectory(`${state}/acknowledgements`),
          1,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'keeps legacy state intact while merging new acknowledgements',
    () =>
      Effect.gen(function* () {
        const { receipts, storage, state } = yield* presentationFixture();
        const legacy = PresentationState.make({
          schemaVersion: 1,
          lastSignature: 'legacy snapshot',
          lastPresentedAt: '1970-01-01T00:00:01.000Z',
          visibleMessageIds: ['legacy-message'],
        });
        yield* storage.writeJson(`${state}/presentation.json`, legacy);
        assert.deepEqual(yield* receipts.read(), legacy);
        assert.isUndefined(yield* receipts.read('claude'));
        const legacyReceipt = 'a'.repeat(64);
        yield* storage.writeJson(`${state}/receipts/${legacyReceipt}.json`, {
          schemaVersion: 1,
          signature: 'legacy receipt',
          createdAt: '1970-01-01T00:00:02.000Z',
          messageIds: [UPDATE.messageId],
        });
        yield* TestClock.setTime(3_000);
        yield* receipts.acknowledge(legacyReceipt, [UPDATE.messageId]);
        const visible = yield* receipts.read();
        assert.equal(visible?.lastSignature, 'legacy receipt');
        assert.sameMembers(
          [...(visible?.visibleMessageIds ?? [])],
          ['legacy-message', 'reply-bob'],
        );
        const preserved = yield* Schema.decodeUnknownEffect(PresentationState)(
          yield* storage.readJson(`${state}/presentation.json`),
        );
        assert.deepEqual(preserved, legacy);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect('requires separate native confirmations for each host', () =>
    Effect.gen(function* () {
      const { receipts } = yield* presentationFixture();
      const rendered = 'UPDATES\nREADY Bob';
      const draft = `${rendered}\n\nBob found the failing retry trace.`;
      const receipt = yield* receipts.issue(
        'snapshot',
        [UPDATE.messageId],
        rendered,
      );
      yield* receipts.acknowledge(receipt, [UPDATE.messageId]);
      assert.isUndefined(yield* receipts.read('claude'));
      yield* receipts.acknowledge(receipt, [UPDATE.messageId], 'claude');
      assert.isFalse((yield* receipts.read('claude'))?.nativeConfirmed);
      assert.deepEqual((yield* receipts.read('claude'))?.visibleMessageIds, []);
      yield* receipts.prepare(receipt, 'claude', draft, [UPDATE.messageId]);
      yield* TestClock.adjust('1 second');
      yield* receipts.confirm('claude', draft);
      assert.deepEqual((yield* receipts.read('claude'))?.visibleMessageIds, [
        UPDATE.messageId,
      ]);
      assert.isUndefined(yield* receipts.read('codex'));
      yield* receipts.prepare(receipt, 'codex', draft, [UPDATE.messageId]);
      yield* receipts.confirm('codex', draft);
      assert.deepEqual((yield* receipts.read('codex'))?.visibleMessageIds, [
        UPDATE.messageId,
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'staging waits for matching native assistant output without changing labels',
    () =>
      Effect.gen(function* () {
        const { board, receipts, calls, storage, state } =
          yield* presentationFixture();
        const result = yield* board.check();
        const draft = `${result.rendered}\n\nBob found a retry failure after the second request.`;
        const pending = yield* receipts.prepare(
          result.receipt ?? '',
          'claude',
          draft,
          [UPDATE.messageId],
        );
        assert.deepEqual(calls, []);
        assert.isUndefined(yield* receipts.read('claude'));
        assert.isTrue((yield* board.check()).shouldPresent);
        assert.deepEqual(yield* receipts.confirm('codex', draft), []);
        assert.deepEqual(
          yield* receipts.confirm(
            'claude',
            `${result.rendered}\n\nStill working.`,
          ),
          [],
        );
        assert.deepEqual(calls, []);
        const nativeText = `Here is Bob's result.\r\n${draft.replaceAll('\n', '\r\n')}\r\nPlease review it.\r\n`;
        const normalized = nativeText.replaceAll('\r\n', '\n').trim();
        const confirmed = yield* receipts.confirm('claude', nativeText);
        assert.lengthOf(confirmed, 1);
        assert.strictEqual(confirmed[0]?.pendingRequestId, pending.requestId);
        assert.strictEqual(
          confirmed[0]?.assistantTextHash,
          createHash('sha256').update(normalized).digest('hex'),
        );
        assert.isTrue((yield* receipts.read('claude'))?.nativeConfirmed);
        assert.deepEqual((yield* receipts.read('claude'))?.visibleMessageIds, [
          UPDATE.messageId,
        ]);
        assert.isFalse((yield* board.check()).shouldPresent);
        assert.deepEqual(yield* receipts.confirm('claude', nativeText), []);
        assert.lengthOf(calls, 1);
        assert.lengthOf(
          yield* storage.listDirectory(`${state}/acknowledgements`),
          1,
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'confirms the most specific matching immutable draft only once',
    () =>
      Effect.gen(function* () {
        const fixture = yield* presentationFixture();
        const result = yield* fixture.board.check();
        const first = `${result.rendered}\n\nBob found the failing retry trace.`;
        const actual = `${first}\nThe repeated second request causes the failure.`;
        const other = `${result.rendered}\n\nA different draft was never shown.`;
        const receipt = result.receipt ?? '';
        yield* fixture.receipts.prepare(receipt, 'codex', first, [
          UPDATE.messageId,
        ]);
        const selected = yield* fixture.receipts.prepare(
          receipt,
          'codex',
          actual,
          [UPDATE.messageId],
        );
        yield* fixture.receipts.prepare(receipt, 'codex', other, [
          UPDATE.messageId,
        ]);
        const independent = yield* Receipts.pipe(
          Effect.provide(fixture.application),
        );
        const outcomes = yield* Effect.all(
          [
            fixture.receipts.confirm('codex', actual),
            independent.confirm('codex', actual),
          ],
          { concurrency: 2 },
        );
        const confirmed = outcomes.flat();
        assert.lengthOf(confirmed, 1);
        assert.strictEqual(confirmed[0]?.pendingRequestId, selected.requestId);
        assert.lengthOf(
          yield* fixture.storage.listDirectory(
            `${fixture.state}/pending-presentations`,
          ),
          3,
        );
        assert.lengthOf(
          yield* fixture.storage.listDirectory(
            `${fixture.state}/acknowledgements`,
          ),
          1,
        );
        assert.deepEqual(yield* independent.confirm('codex', actual), []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'rejects incomplete or foreign drafts and retains manual legacy receipts',
    () =>
      Effect.gen(function* () {
        const { receipts, board, calls, storage, state } =
          yield* presentationFixture();
        const result = yield* board.check();
        const receipt = result.receipt ?? '';
        for (const [draft, ids] of [
          ['', []],
          ['UPDATES\nALL CLEAR', []],
          [result.rendered, [UPDATE.messageId]],
          [`${result.rendered}\n\nBob's result.`, ['not-in-snapshot']],
        ] as const) {
          assert.strictEqual(
            (yield* receipts
              .prepare(receipt, 'claude', draft, ids)
              .pipe(Effect.result))._tag,
            'Failure',
          );
        }
        const legacy = yield* receipts.issue('legacy', [UPDATE.messageId]);
        assert.strictEqual(
          (yield* receipts
            .prepare(legacy, 'claude', 'UPDATES\nREADY Bob', [])
            .pipe(Effect.result))._tag,
          'Failure',
        );
        assert.deepEqual(
          yield* storage.listDirectory(`${state}/pending-presentations`),
          [],
        );
        assert.deepEqual(calls, []);
        yield* receipts.acknowledge(legacy, [UPDATE.messageId], 'openClaw');
        assert.deepEqual(
          (yield* receipts.read('openClaw'))?.visibleMessageIds,
          [UPDATE.messageId],
        );
        assert.isFalse((yield* receipts.read('openClaw'))?.nativeConfirmed);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'does not promote legacy native IDs through a later board-only confirmation',
    () =>
      Effect.gen(function* () {
        const { receipts, board } = yield* presentationFixture();
        const legacy = yield* receipts.issue('legacy', [UPDATE.messageId]);
        yield* receipts.acknowledge(legacy, [UPDATE.messageId], 'claude');
        assert.isUndefined(yield* receipts.read());
        yield* TestClock.adjust('1 second');
        const result = yield* board.check();
        yield* receipts.prepare(
          result.receipt ?? '',
          'claude',
          result.rendered,
          [],
        );
        yield* receipts.confirm('claude', result.rendered);
        assert.isTrue((yield* receipts.read('claude'))?.nativeConfirmed);
        assert.deepEqual(
          (yield* receipts.read('claude'))?.visibleMessageIds,
          [],
        );
        assert.isTrue((yield* board.check()).shouldPresent);
        yield* TestClock.adjust('1 second');
        const newer = yield* receipts.issue('newer legacy assertion', [
          UPDATE.messageId,
        ]);
        yield* receipts.acknowledge(newer, [UPDATE.messageId], 'claude');
        assert.isFalse((yield* receipts.read('claude'))?.nativeConfirmed);
        assert.deepEqual(
          (yield* receipts.read('claude'))?.visibleMessageIds,
          [],
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'rejects corrupt persisted timestamps before they count as visible evidence',
    () =>
      Effect.gen(function* () {
        const { receipts, storage, state, calls } =
          yield* presentationFixture();
        yield* storage.writeJson(`${state}/presentation.json`, {
          schemaVersion: 1,
          lastSignature: 'corrupt',
          lastPresentedAt: 'not-a-timestamp',
        });
        assert.equal(
          (yield* receipts.read().pipe(Effect.result))._tag,
          'Failure',
        );
        const receipt = 'b'.repeat(64);
        yield* storage.writeJson(`${state}/receipts/${receipt}.json`, {
          schemaVersion: 1,
          signature: 'corrupt',
          createdAt: '2026-02-31T00:00:00.000Z',
          messageIds: [UPDATE.messageId],
        });
        assert.equal(
          (yield* receipts
            .acknowledge(receipt, [UPDATE.messageId])
            .pipe(Effect.result))._tag,
          'Failure',
        );
        assert.deepEqual(calls, []);
        assert.equal(
          Schema.decodeUnknownResult(PresentationState)({
            schemaVersion: 1,
            lastSignature: 'corrupt',
            lastPresentedAt: '',
          })._tag,
          'Failure',
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
