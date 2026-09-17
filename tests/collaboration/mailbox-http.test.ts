/**
 * @file Verifies real mail operations against a stateful HTTP boundary.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, layer } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Match from 'effect/Match';
import * as Schema from 'effect/Schema';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

import { Mailbox, mailboxLayer } from '../../src/collaboration/mail/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';

interface WireMessage {
  readonly messageId: string;
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly timestamp: string;
  labels: string[];
}

class WireState extends Context.Service<
  WireState,
  {
    readonly messages: WireMessage[];
    labels: string[];
    malformed: boolean;
  }
>()('test/WireState') {}

const labelPatch = Schema.Struct({
  add_labels: Schema.Array(Schema.String),
  remove_labels: Schema.Array(Schema.String),
});

const wireStateLayer = Layer.sync(WireState)(() => ({
  messages: [
    {
      messageId: 'request-alice',
      from: 'Alice <alice@agentmail.to>',
      to: ['Bob <bob@agentmail.to>'],
      subject: '[COLLAB] Retry failure trace',
      text: 'This substantive message must not appear on the board.',
      timestamp: '2026-09-12T00:00:00.000Z',
      labels: ['sent'],
    },
  ],
  labels: ['sh-collaboration', 'sh-waiting'],
  malformed: false,
}));

const clientLayer = Layer.effect(HttpClient.HttpClient)(
  Effect.gen(function* () {
    const state = yield* WireState;
    return HttpClient.make((request, url) =>
      Effect.sync(() => {
        if (state.malformed) {
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ unexpected: true }),
          );
        }
        if (request.method === 'PATCH') {
          const body = request.body;
          const text = Match.value(body).pipe(
            Match.tag('Uint8Array', (value) =>
              new TextDecoder().decode(value.body),
            ),
            Match.orElse(() => '{}'),
          );
          const patch = Schema.decodeUnknownSync(
            Schema.fromJsonString(labelPatch),
          )(text);
          const target = url.pathname.includes('/messages/')
            ? state.messages.find((message) =>
                url.pathname.endsWith(encodeURIComponent(message.messageId)),
              )
            : undefined;
          const labels = target?.labels ?? state.labels;
          const updated = [
            ...new Set([
              ...labels.filter((label) => !patch.remove_labels.includes(label)),
              ...patch.add_labels,
            ]),
          ];
          if (target === undefined) {
            state.labels = updated;
          } else {
            target.labels = updated;
          }
          return HttpClientResponse.fromWeb(request, Response.json({}));
        }
        const thread = {
          thread_id: 'thread-bob',
          subject: '[COLLAB] Retry failure trace',
          labels: state.labels,
          messages: state.messages.map(({ messageId, ...message }) => ({
            ...message,
            message_id: messageId,
          })),
        };
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            url.pathname.endsWith('/threads') ? { threads: [thread] } : thread,
          ),
        );
      }),
    );
  }),
);

const dependencies = Layer.mergeAll(
  pathsLayer.pipe(Layer.provide(NodeServices.layer)),
  Layer.mock(Storage)({
    readText: (path) =>
      Effect.succeed(
        new Map([
          ['/fixture/.agentmail/key', 'fixture-secret-never-log'],
          ['/fixture/.agentmail/inbox', 'alice@agentmail.to'],
        ]).get(path),
      ),
  }),
  clientLayer.pipe(Layer.provideMerge(wireStateLayer)),
).pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        HOME: '/fixture',
        AGENTMAIL_API_KEY: 'fixture-secret-never-log',
        AGENTMAIL_INBOX: 'alice@agentmail.to',
      }),
    ),
  ),
);

describe('AgentMail HTTP contract', () => {
  layer(mailboxLayer.pipe(Layer.provideMerge(dependencies)))((it) => {
    it.effect(
      'keeps request, reply, visibility, completion and reopening distinct',
      () =>
        Effect.gen(function* () {
          const mailbox = yield* Mailbox;
          const wire = yield* WireState;
          const request = (yield* mailbox.listUpdates())[0];
          assert.strictEqual(request?.collaborator, 'Bob <bob@agentmail.to>');
          assert.strictEqual(request?.summary, 'Retry failure trace');
          wire.messages.push({
            messageId: 'reply-bob',
            from: 'Bob <bob@agentmail.to>',
            to: ['alice@agentmail.to'],
            subject: 'Re: [COLLAB] Retry failure trace',
            text: 'The second request loses its body.',
            timestamp: '2026-09-12T00:01:00.000Z',
            labels: ['unread'],
          });
          assert.strictEqual((yield* mailbox.syncUpdates())[0]?.kind, 'ready');
          yield* mailbox.triage('reply-bob', 'needsYou');
          assert.strictEqual(
            (yield* mailbox.listUpdates())[0]?.kind,
            'needsYou',
          );
          yield* mailbox.markPresented(['reply-bob']);
          assert.include(wire.messages[1]?.labels ?? [], 'unread');
          assert.notInclude(wire.messages[1]?.labels ?? [], 'sh-done');
          yield* mailbox.complete('reply-bob');
          assert.deepEqual(yield* mailbox.listUpdates(), []);
          assert.include(wire.messages[1]?.labels ?? [], 'read');
          assert.notInclude(wire.messages[1]?.labels ?? [], 'unread');
          wire.messages.push({
            messageId: 'later-bob',
            from: 'Bob <bob@agentmail.to>',
            to: ['alice@agentmail.to'],
            subject: 'Re: [COLLAB] Retry failure trace',
            text: 'A later result.',
            timestamp: '2026-09-12T00:02:00.000Z',
            labels: ['unread'],
          });
          assert.strictEqual(
            (yield* mailbox.listUpdates())[0]?.messageId,
            'later-bob',
          );
          yield* mailbox.triage('later-bob', 'working');
          assert.strictEqual(
            (yield* mailbox.listUpdates())[0]?.kind,
            'working',
          );
          assert.include(wire.messages[2]?.labels ?? [], 'unread');
        }),
    );
    it.effect(
      'rejects malformed external responses without exposing credentials',
      () =>
        Effect.gen(function* () {
          const mailbox = yield* Mailbox;
          const wire = yield* WireState;
          wire.malformed = true;
          const result = yield* mailbox.listItems().pipe(Effect.result);
          assert.strictEqual(result._tag, 'Failure');
          assert.notInclude(JSON.stringify(result), 'fixture-secret-never-log');
        }),
    );
  });
});
