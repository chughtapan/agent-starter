/**
 * @file Reads canonical test-mail labels without product-side reconciliation.
 */

import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';

import {
  EvaluationError,
  type MailSnapshot,
  type Profile,
  type TestIdentity,
} from './domain/index.js';

const Identity = Schema.Struct({
  agentName: Schema.String,
  agentEmail: Schema.String,
  ownerEmail: Schema.String,
});
const Thread = Schema.Struct({
  thread_id: Schema.String,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  subject: Schema.optionalKey(Schema.String),
});
const Threads = Schema.Struct({
  threads: Schema.Array(Thread),
  next_page_token: Schema.optionalKey(Schema.String),
});
const Address = Schema.Union([
  Schema.String,
  Schema.Struct({
    email: Schema.optionalKey(Schema.String),
    address: Schema.optionalKey(Schema.String),
  }),
]);
const Detail = Schema.Struct({
  thread_id: Schema.String,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  messages: Schema.Array(
    Schema.Struct({
      message_id: Schema.String,
      labels: Schema.optionalKey(Schema.Array(Schema.String)),
      from: Schema.optionalKey(Address),
      sender: Schema.optionalKey(Address),
      to: Schema.optionalKey(Schema.Array(Address)),
      cc: Schema.optionalKey(Schema.Array(Address)),
    }),
  ),
});

/** Mail runs require exact declared identities and separately verified inboxes. */
export const verifyMailIdentity = Effect.fn('evals.verifyMailIdentity')(
  function* (
    profile: Profile,
    declared: TestIdentity,
    allowedEmails: readonly string[],
    peer: TestIdentity,
  ) {
    const fs = yield* FileSystem.FileSystem;
    if (declared.inbox === undefined || declared.ownerEmail === undefined) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'identity',
          reason:
            'Declare distinct owner aliases and verified dedicated test inboxes before a mail scenario.',
        }),
      );
    }
    for (const filename of [
      `${profile.harness}/state/identity.json`,
      `${profile.agentmail}/inbox`,
      `${profile.agentmail}/key`,
    ]) {
      if (!(yield* fs.exists(filename))) {
        return yield* Effect.fail(
          EvaluationError.make({
            operation: 'identity',
            reason:
              'Dedicated profile is not onboarded with its own verified mailbox.',
          }),
        );
      }
    }
    if (yield* fs.exists(`${profile.agentmail}/pending-otp`)) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'identity',
          reason: 'Dedicated mailbox verification is still pending.',
        }),
      );
    }
    const identity = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Identity),
    )(yield* fs.readFileString(`${profile.harness}/state/identity.json`));
    const inbox = (yield* fs.readFileString(
      `${profile.agentmail}/inbox`,
    )).trim();
    if (
      identity.agentName !== declared.name ||
      identity.agentEmail !== declared.inbox ||
      identity.ownerEmail !== declared.ownerEmail ||
      inbox !== declared.inbox
    ) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'identity',
          reason:
            'Declared test identity does not exactly match isolated runtime and mailbox metadata.',
        }),
      );
    }
    for (const filename of [
      `${profile.harness}/state/identity.json`,
      `${profile.harness}/agent/roster.md`,
      `${profile.harness}/agent/PROTOCOL.md`,
    ]) {
      const content = yield* fs.readFileString(filename);
      const emails = emailAddresses(content);
      if (emails.some((email) => !allowedEmails.includes(email))) {
        return yield* Effect.fail(
          EvaluationError.make({
            operation: 'identity',
            reason:
              'Installed identity, roster, or protocol contains a recipient outside the declared test pair and owners.',
          }),
        );
      }
    }
    const roster = emailAddresses(
      yield* fs.readFileString(`${profile.harness}/agent/roster.md`),
    );
    const required = [
      declared.inbox,
      declared.ownerEmail,
      peer.inbox,
      peer.ownerEmail,
    ];
    if (
      required.some((email) => email === undefined || !roster.includes(email))
    ) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'identity',
          reason:
            'Both dedicated agents and their owners must be present in the isolated roster before a collaboration scenario.',
        }),
      );
    }
  },
);

/** Uses GET only; the real service remains the oracle for unread and done. */
export const snapshotMail = Effect.fn('evals.snapshotMail')(
  function* (profile: Profile, marker: string) {
    const fs = yield* FileSystem.FileSystem;
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
    );
    const inbox = (yield* fs.readFileString(
      `${profile.agentmail}/inbox`,
    )).trim();
    const key = (yield* fs.readFileString(`${profile.agentmail}/key`)).trim();
    if (key.length === 0) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'snapshot',
          reason: 'Dedicated mailbox credential is empty.',
        }),
      );
    }
    const base = `https://api.agentmail.to/v0/inboxes/${encodeURIComponent(inbox)}/threads`;
    const get = Effect.fn('evals.mailGet')(function* (url: string) {
      const response = yield* client.execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({ authorization: `Bearer ${key}` }),
        ),
      );
      return yield* response.json;
    });
    const summaries: Array<typeof Thread.Type> = [];
    const tokens = new Set<string>();
    let next: string | undefined;
    for (let page = 0; page < 100; page++) {
      const query =
        next === undefined
          ? '?limit=100'
          : `?limit=100&page_token=${encodeURIComponent(next)}`;
      const result = yield* Schema.decodeUnknownEffect(Threads)(
        yield* get(`${base}${query}`),
      );
      summaries.push(
        ...result.threads.filter(
          (thread) => thread.subject?.includes(marker) === true,
        ),
      );
      next = result.next_page_token;
      if (next === undefined) {
        break;
      }
      if (tokens.has(next) || page === 99) {
        return yield* Effect.fail(
          EvaluationError.make({
            operation: 'snapshot',
            reason:
              'Canonical mailbox pagination was repeated or exceeded its evidence limit.',
          }),
        );
      }
      tokens.add(next);
    }
    const threads = yield* Effect.forEach(
      summaries,
      (thread) =>
        get(`${base}/${encodeURIComponent(thread.thread_id)}`).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Detail)),
        ),
      { concurrency: 1 },
    );
    return {
      threads: threads.map((thread) => ({
        thread_id: thread.thread_id,
        labels: thread.labels ?? [],
        messages: thread.messages.map((message) => {
          const sender = message.from ?? message.sender;
          return {
            message_id: message.message_id,
            labels: message.labels ?? [],
            sender: sender === undefined ? '' : addressEmail(sender),
            recipients: [...(message.to ?? []), ...(message.cc ?? [])].map(
              addressEmail,
            ),
          };
        }),
      })),
    } satisfies MailSnapshot;
  },
  Effect.timeout('20 seconds'),
  Effect.mapError(() =>
    EvaluationError.make({
      operation: 'snapshot',
      reason: 'Canonical mailbox label evidence could not be read or decoded.',
    }),
  ),
);

function addressEmail(address: typeof Address.Type): string {
  if (typeof address !== 'string') {
    return (address.email ?? address.address ?? '').trim().toLowerCase();
  }
  return (/<([^<>]+)>/.exec(address)?.[1] ?? address).trim().toLowerCase();
}

function emailAddresses(content: string): readonly string[] {
  return content
    .split(/[\s<>"(),:;[\]|*`]+/)
    .filter((token) => token.includes('@'))
    .map((email) => (email.endsWith('.') ? email.slice(0, -1) : email));
}
