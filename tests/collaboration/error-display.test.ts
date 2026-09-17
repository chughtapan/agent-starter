/**
 * @file Checks actionable error rendering without leaking transport data.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as Cause from 'effect/Cause';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { FastCheck } from 'effect/testing';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

import {
  Mailbox,
  MailboxError,
  mailboxLayer,
} from '../../src/collaboration/mail/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';

const SECRET = 'fixture-private-token-do-not-render';

const failedMailRequest = Effect.fn('test.failedMailRequest')(function* (
  response: Response,
  signup: boolean,
) {
  const config = ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      HOME: '/fixture',
      ...(signup
        ? {}
        : { AGENTMAIL_API_KEY: SECRET, AGENTMAIL_INBOX: 'alice@example.com' }),
    }),
  );
  const dependencies = Layer.mergeAll(
    pathsLayer,
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, response)),
      ),
    ),
    Layer.mock(Storage)({
      readText: () => Effect.succeed(undefined),
      exists: () => Effect.succeed(false),
    }),
  ).pipe(Layer.provide(config), Layer.provide(NodeServices.layer));
  return yield* Effect.gen(function* () {
    const mailbox = yield* Mailbox;
    return yield* (
      signup
        ? mailbox
            .ensureInbox('owner@example.com', 'example-agent')
            .pipe(Effect.asVoid)
        : mailbox.verifyConnection().pipe(Effect.asVoid)
    ).pipe(Effect.result);
  }).pipe(
    Effect.provide(
      mailboxLayer.pipe(Layer.provide(dependencies), Layer.provide(config)),
    ),
  );
});

describe('safe expected errors', () => {
  it.prop(
    'reason text cannot inject terminal control characters',
    [FastCheck.string()],
    ([reason]) => {
      const error = MailboxError.make({
        operation: 'verifyConnection',
        reason,
      });
      assert.include(error.message, 'verifyConnection:');
      assert.notMatch(error.message, /[\p{Cc}\p{Cf}]/u);
    },
  );

  it('retains actionable context while omitting nested HTTP and response secrets', () =>
    Effect.gen(function* () {
      const cases = [
        {
          response: new Response(SECRET, {
            status: 403,
            headers: { authorization: SECRET },
          }),
          signup: false,
          operation: 'verifyConnection',
        },
        {
          response: new Response(SECRET, {
            status: 403,
            headers: { authorization: SECRET },
          }),
          signup: true,
          operation: 'signup',
        },
        {
          response: new Response(`not JSON: ${SECRET}`),
          signup: false,
          operation: 'verifyConnection',
        },
        {
          response: Response.json({ inbox_id: { authorization: SECRET } }),
          signup: false,
          operation: 'verifyConnection',
        },
      ];
      for (const item of cases) {
        const result = yield* failedMailRequest(item.response, item.signup);
        assert.strictEqual(result._tag, 'Failure');
        if (result._tag === 'Failure') {
          const rendered = Cause.pretty(Cause.fail(result.failure));
          assert.include(rendered, `${item.operation}:`);
          assert.notInclude(rendered, SECRET);
          assert.notInclude(rendered.toLowerCase(), 'authorization');
          assert.notInclude(JSON.stringify(result.failure), SECRET);
          assert.isUndefined(result.failure.cause);
        }
      }
    }).pipe(Effect.runPromise));
});
