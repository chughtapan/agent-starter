/**
 * @file Implements the AgentMail transport and current collaboration state.
 */

import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Redacted from 'effect/Redacted';
import * as Schema from 'effect/Schema';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';

import {
  CollaborationItem,
  CollaborationUpdate,
  type UpdateKind,
} from './domain/collaboration.js';
import {
  AmbiguousCompletionError,
  MailboxError,
  type StorageError,
} from './errors.js';
import { Paths } from './paths.js';
import { Storage } from './storage.js';

/** Labels used on collaboration threads. */
export const THREAD_LABELS = {
  collaboration: 'sh-collaboration',
  failed: 'sh-failed',
  waiting: 'sh-waiting',
  working: 'sh-working',
};

/** Labels used on individual collaboration messages. */
export const MESSAGE_LABELS = {
  done: 'sh-done',
  needsYou: 'sh-needs-you',
  presented: 'sh-presented',
  ready: 'sh-ready',
  triaged: 'sh-triaged',
};

const COLLABORATION_SUBJECT = /^(?:Re:\s*)*\[(?:COLLAB|INTRO)\]\s*/i;

/**
 * Identifies the transport marker used to discover a new collaboration.
 * @param subject Message subject supplied by the transport, when present.
 * @returns Whether the subject carries a collaboration or introduction marker.
 */
export function isCollaborationSubject(subject?: string): boolean {
  if (subject === undefined) {
    return false;
  }
  return COLLABORATION_SUBJECT.test(subject);
}

const MailAddressWire = Schema.Struct({
  email: Schema.optionalKey(Schema.String),
  address: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
});

const SenderWire = Schema.Union([Schema.String, MailAddressWire]);

const AttachmentWire = Schema.Struct({
  filename: Schema.optionalKey(Schema.String),
  content_type: Schema.optionalKey(Schema.String),
});

const MailMessageWire = Schema.Struct({
  // These names mirror AgentMail's external wire contract.
  message_id: Schema.String,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  from: Schema.optionalKey(SenderWire),
  sender: Schema.optionalKey(SenderWire),
  subject: Schema.optionalKey(Schema.String),
  text: Schema.optionalKey(Schema.String),
  extracted_text: Schema.optionalKey(Schema.String),
  preview: Schema.optionalKey(Schema.String),
  attachments: Schema.optionalKey(Schema.Array(AttachmentWire)),
  timestamp: Schema.optionalKey(Schema.String),
  created_at: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
});

const ThreadSummaryWire = Schema.Struct({
  // These names mirror AgentMail's external wire contract.
  thread_id: Schema.String,
  last_message_id: Schema.optionalKey(Schema.String),
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  subject: Schema.optionalKey(Schema.String),
  preview: Schema.optionalKey(Schema.String),
  senders: Schema.optionalKey(Schema.Array(Schema.String)),
  timestamp: Schema.optionalKey(Schema.String),
  created_at: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
});

const ThreadsResponseWire = Schema.Struct({
  threads: Schema.Array(ThreadSummaryWire),
  next_page_token: Schema.optionalKey(Schema.String),
});

const ThreadDetailWire = Schema.Struct({
  // These names mirror AgentMail's external wire contract.
  thread_id: Schema.String,
  labels: Schema.optionalKey(Schema.Array(Schema.String)),
  subject: Schema.optionalKey(Schema.String),
  preview: Schema.optionalKey(Schema.String),
  senders: Schema.optionalKey(Schema.Array(Schema.String)),
  timestamp: Schema.optionalKey(Schema.String),
  created_at: Schema.optionalKey(Schema.String),
  updated_at: Schema.optionalKey(Schema.String),
  messages: Schema.Array(MailMessageWire),
});

interface SendInput {
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly threadLabels: readonly string[];
}

interface SendResult {
  readonly messageId: string;
  readonly threadId: string;
}

/** Timestamps that determine a message's chronological position. */
export interface MessageChronology {
  readonly timestamp?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
}

/** Label state exposed for bounded maintenance transformations. */
export interface MailboxLabelSnapshot {
  readonly threadId: string;
  readonly threadLabels: ReadonlySet<string>;
}

/** Describes one transport-neutral label rewrite. */
export interface MailboxLabelRewrite {
  readonly addThreadLabels: readonly string[];
  readonly removeThreadLabels: readonly string[];
  readonly addMessageLabels: readonly string[];
  readonly removeMessageLabels: readonly string[];
}

/** Result of creating or reusing the owner's agent inbox. */
interface InboxProvisionResult {
  readonly inbox: string;
  readonly verificationRequired: boolean;
}

/** Provides the AgentMail operations used by collaboration workflows. */
export interface MailboxService {
  readonly ensureInbox: (
    ownerEmail: string,
    username: string,
  ) => Effect.Effect<InboxProvisionResult, MailboxError | StorageError>;
  readonly verifySignup: (
    otpCode: string,
  ) => Effect.Effect<void, MailboxError | StorageError>;
  readonly listUpdates: () => Effect.Effect<
    readonly CollaborationUpdate[],
    MailboxError | StorageError
  >;
  readonly listItems: () => Effect.Effect<
    readonly CollaborationItem[],
    MailboxError | StorageError
  >;
  readonly syncUpdates: () => Effect.Effect<
    readonly CollaborationUpdate[],
    MailboxError | StorageError
  >;
  readonly markPresented: (
    messageIds: readonly string[],
  ) => Effect.Effect<void, MailboxError | StorageError>;
  readonly complete: (
    messageId?: string,
    all?: boolean,
  ) => Effect.Effect<
    readonly string[],
    AmbiguousCompletionError | MailboxError | StorageError
  >;
  readonly send: (
    input: SendInput,
  ) => Effect.Effect<SendResult, MailboxError | StorageError>;
  readonly reply: (
    messageId: string,
    text: string,
    cc: readonly string[],
  ) => Effect.Effect<SendResult, MailboxError | StorageError>;
  readonly verifyConnection: () => Effect.Effect<
    string,
    MailboxError | StorageError
  >;
  readonly rewriteLabels: (
    rewrite: (
      snapshot: MailboxLabelSnapshot,
    ) => MailboxLabelRewrite | undefined,
  ) => Effect.Effect<number, MailboxError | StorageError>;
}

/** Identifies the AgentMail collaboration service. */
export class Mailbox extends Context.Service<Mailbox, MailboxService>()(
  'social-harness/Mailbox',
) {}

/**
 * Applies the canonical message-first collaboration state precedence.
 * @param messageLabels State labels attached to the newest message.
 * @param threadLabels Progress labels attached to the conversation thread.
 * @param inbound Whether the newest message came from another inbox.
 * @param unread Whether the newest message remains unread.
 * @returns The visible update state, or undefined when no item is open.
 */
export function classifyUpdateKind(
  messageLabels: ReadonlySet<string>,
  threadLabels: ReadonlySet<string>,
  inbound: boolean,
  unread: boolean,
): UpdateKind | undefined {
  if (messageLabels.has(MESSAGE_LABELS.done)) {
    return undefined;
  }
  if (messageLabels.has(MESSAGE_LABELS.needsYou)) {
    return 'needsYou';
  }
  if (messageLabels.has(MESSAGE_LABELS.ready)) {
    return 'ready';
  }
  if (threadLabels.has(THREAD_LABELS.collaboration) && inbound && unread) {
    return 'ready';
  }
  if (threadLabels.has(THREAD_LABELS.failed)) {
    return 'failed';
  }
  if (threadLabels.has(THREAD_LABELS.waiting)) {
    return 'waiting';
  }
  if (threadLabels.has(THREAD_LABELS.working)) {
    return 'working';
  }
  if (threadLabels.has(THREAD_LABELS.collaboration) && !inbound) {
    return 'working';
  }
  return undefined;
}

/**
 * Selects the latest delivered message without treating label edits as replies.
 * @param messages Messages whose delivery chronology should be compared.
 * @returns The latest delivered message, or undefined for an empty collection.
 */
export function selectLatestMessage<Message extends MessageChronology>(
  messages: readonly Message[],
): Message | undefined {
  return [...messages].sort((left, right) =>
    messageTimestamp(right).localeCompare(messageTimestamp(left)),
  )[0];
}

function classifyItem(
  thread: typeof ThreadDetailWire.Type,
  inbox: string,
): CollaborationItem | undefined {
  const update = classifyThread(thread, inbox);
  const message = selectLatestMessage(thread.messages);
  if (update === undefined || message === undefined) {
    return undefined;
  }
  return CollaborationItem.make({
    update,
    senderEmail: senderEmail(message.from ?? message.sender),
    text: message.extracted_text ?? message.text ?? message.preview ?? '',
    attachments: (message.attachments ?? []).map(
      (attachment) =>
        attachment.filename ?? attachment.content_type ?? 'unnamed attachment',
    ),
  });
}

function classifyThread(
  thread: typeof ThreadDetailWire.Type,
  inbox: string,
): CollaborationUpdate | undefined {
  const message = selectLatestMessage(thread.messages);
  if (message === undefined) {
    return undefined;
  }
  const messageLabels = new Set(message.labels ?? []);
  const threadLabels = new Set(thread.labels ?? []);
  const unread = messageLabels.has('unread');
  const inbound =
    senderEmail(message.from ?? message.sender) !== inbox.toLowerCase();
  const kind = classifyUpdateKind(messageLabels, threadLabels, inbound, unread);
  if (kind === undefined) {
    return undefined;
  }
  return CollaborationUpdate.make({
    threadId: thread.thread_id,
    messageId: message.message_id,
    kind,
    collaborator: senderText(message.from ?? message.sender),
    summary: summarize(message, thread),
    updatedAt: messageTimestamp(message),
    labels: [...messageLabels, ...threadLabels].sort((left, right) =>
      left.localeCompare(right),
    ),
    unread,
    subject: message.subject ?? thread.subject ?? '',
  });
}

function senderEmail(sender?: typeof SenderWire.Type): string {
  if (sender === undefined) {
    return '';
  }
  if (typeof sender === 'string') {
    const openBracket = sender.indexOf('<');
    const closeBracket = sender.indexOf('>', openBracket + 1);
    const address =
      openBracket >= 0 && closeBracket > openBracket + 1
        ? sender.slice(openBracket + 1, closeBracket)
        : sender;
    return address.trim().toLowerCase();
  }
  return (sender.email ?? sender.address ?? '').trim().toLowerCase();
}

function senderText(sender?: typeof SenderWire.Type): string {
  if (sender === undefined) {
    return 'unknown collaborator';
  }
  if (typeof sender === 'string') {
    return sender;
  }
  return (
    sender.name ?? sender.email ?? sender.address ?? 'unknown collaborator'
  );
}

function summarize(
  message: typeof MailMessageWire.Type,
  thread: typeof ThreadDetailWire.Type,
): string {
  const source =
    message.extracted_text ??
    message.text ??
    message.preview ??
    message.subject ??
    thread.preview ??
    thread.subject ??
    'collaboration update';
  const firstLine = source.split('\n')[0]?.trim() ?? 'collaboration update';
  return firstLine.length <= 96
    ? firstLine
    : `${firstLine.slice(0, 93).trimEnd()}...`;
}

function messageTimestamp(message: MessageChronology): string {
  return (
    message.timestamp ??
    message.created_at ??
    message.updated_at ??
    '1970-01-01T00:00:00.000Z'
  );
}

function mailboxFailure(
  operation: string,
  reason: string,
  cause?: unknown,
): MailboxError {
  if (cause === undefined) {
    return MailboxError.make({ operation, reason });
  }
  return MailboxError.make({ operation, reason, cause });
}

function decodeResponse<S extends Schema.Top>(
  schema: S,
  operation: string,
  value: unknown,
): Effect.Effect<S['Type'], MailboxError, S['DecodingServices']> {
  return Schema.decodeUnknownEffect(schema)(value).pipe(
    Effect.mapError((error) =>
      mailboxFailure(operation, `invalid AgentMail response: ${error.message}`),
    ),
  );
}

function sendResult(value: unknown): Effect.Effect<SendResult, MailboxError> {
  return Schema.decodeUnknownEffect(
    Schema.Struct({
      // These names mirror AgentMail's external wire contract.
      message_id: Schema.String,
      thread_id: Schema.String,
    }),
  )(value).pipe(
    Effect.map(
      (decoded): SendResult => ({
        messageId: decoded.message_id,
        threadId: decoded.thread_id,
      }),
    ),
    Effect.mapError((error) =>
      mailboxFailure('send', `invalid AgentMail response: ${error.message}`),
    ),
  );
}

/** Provides AgentMail through Effect's HTTP client and local credentials. */
export const mailboxLayer = Layer.effect(Mailbox)(
  Effect.gen(function* () {
    const httpClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.filterStatusOk,
    );
    const paths = yield* Paths;
    const storage = yield* Storage;
    const apiBase = yield* Config.string('AGENTMAIL_API').pipe(
      Config.withDefault('https://api.agentmail.to'),
    );
    const configuredKey = yield* Config.option(
      Config.redacted('AGENTMAIL_API_KEY'),
    );
    const configuredInbox = yield* Config.option(
      Config.string('AGENTMAIL_INBOX'),
    );

    const credentials = Effect.fn('Mailbox.credentials')(function* () {
      const keyFromFile = yield* storage.readText(paths.agentmailKey);
      const inboxFromFile = yield* storage.readText(paths.agentmailInbox);
      const redactedKey = Option.getOrUndefined(configuredKey);
      const key =
        (redactedKey === undefined
          ? undefined
          : Redacted.value(redactedKey).trim()) ?? keyFromFile?.trim();
      const inbox =
        Option.getOrUndefined(configuredInbox)?.trim() ?? inboxFromFile?.trim();
      if (key === undefined || key.length === 0) {
        return yield* Effect.fail(
          mailboxFailure('credentials', `missing ${paths.agentmailKey}`),
        );
      }
      if (inbox === undefined || inbox.length === 0) {
        return yield* Effect.fail(
          mailboxFailure('credentials', `missing ${paths.agentmailInbox}`),
        );
      }
      return { key, inbox };
    });

    const executeJson = Effect.fn('Mailbox.executeJson')(function* (
      request: HttpClientRequest.HttpClientRequest,
      operation: string,
    ) {
      const { key } = yield* credentials();
      const authorized = request.pipe(
        HttpClientRequest.setHeaders({
          accept: 'application/json',
          authorization: `Bearer ${key}`,
        }),
      );
      const response = yield* httpClient
        .execute(authorized)
        .pipe(
          Effect.mapError((cause) =>
            mailboxFailure(operation, cause.message, cause),
          ),
        );
      return yield* response.json.pipe(
        Effect.mapError((cause) =>
          mailboxFailure(operation, 'response was not JSON', cause),
        ),
      );
    });

    const executePublicJson = Effect.fn('Mailbox.executePublicJson')(function* (
      request: HttpClientRequest.HttpClientRequest,
      operation: string,
      body: unknown,
    ) {
      const withBody = yield* request.pipe(
        HttpClientRequest.bodyJson(body),
        Effect.mapError((cause) =>
          mailboxFailure(operation, 'request body was not JSON', cause),
        ),
      );
      const response = yield* httpClient
        .execute(withBody)
        .pipe(
          Effect.mapError((cause) =>
            mailboxFailure(operation, cause.message, cause),
          ),
        );
      return yield* response.json.pipe(
        Effect.mapError((cause) =>
          mailboxFailure(operation, 'response was not JSON', cause),
        ),
      );
    });

    const executeBody = Effect.fn('Mailbox.executeBody')(function* (
      request: HttpClientRequest.HttpClientRequest,
      operation: string,
      body: unknown,
    ) {
      const withBody = yield* request.pipe(
        HttpClientRequest.bodyJson(body),
        Effect.mapError((cause) =>
          mailboxFailure(operation, 'request body was not JSON', cause),
        ),
      );
      return yield* executeJson(withBody, operation);
    });

    const updateMessage = Effect.fn('Mailbox.updateMessage')(function* (
      messageId: string,
      addLabels: readonly string[],
      removeLabels: readonly string[],
    ) {
      const { inbox } = yield* credentials();
      const url = `${apiBase}/v0/inboxes/${encodeURIComponent(
        inbox,
      )}/messages/${encodeURIComponent(messageId)}`;
      yield* executeBody(HttpClientRequest.patch(url), 'updateMessage', {
        add_labels: addLabels,
        remove_labels: removeLabels,
      });
    });

    const updateThread = Effect.fn('Mailbox.updateThread')(function* (
      threadId: string,
      addLabels: readonly string[],
      removeLabels: readonly string[],
    ) {
      const { inbox } = yield* credentials();
      const url = `${apiBase}/v0/inboxes/${encodeURIComponent(
        inbox,
      )}/threads/${encodeURIComponent(threadId)}`;
      yield* executeBody(HttpClientRequest.patch(url), 'updateThread', {
        add_labels: addLabels,
        remove_labels: removeLabels,
      });
    });

    const listAllThreads = (operation: string) => {
      const loadPage = (
        inbox: string,
        pageToken?: string,
      ): Effect.Effect<
        ReadonlyArray<typeof ThreadSummaryWire.Type>,
        MailboxError | StorageError
      > =>
        Effect.gen(function* () {
          const query =
            pageToken === undefined
              ? 'limit=100'
              : `limit=100&page_token=${encodeURIComponent(pageToken)}`;
          const listUrl = `${apiBase}/v0/inboxes/${encodeURIComponent(
            inbox,
          )}/threads?${query}`;
          const listValue = yield* executeJson(
            HttpClientRequest.get(listUrl),
            operation,
          );
          const list = yield* decodeResponse(
            ThreadsResponseWire,
            operation,
            listValue,
          );
          if (list.next_page_token === undefined) {
            return list.threads;
          }
          return [
            ...list.threads,
            ...(yield* loadPage(inbox, list.next_page_token)),
          ];
        });
      return Effect.gen(function* () {
        const { inbox } = yield* credentials();
        return yield* loadPage(inbox);
      });
    };

    const ensureInbox = Effect.fn('Mailbox.ensureInbox')(function* (
      ownerEmail: string,
      username: string,
    ) {
      const existingKey = yield* storage.readText(paths.agentmailKey);
      const existingInbox = yield* storage.readText(paths.agentmailInbox);
      if (
        existingKey !== undefined &&
        existingKey.trim().length > 0 &&
        existingInbox !== undefined &&
        existingInbox.trim().length > 0
      ) {
        return {
          inbox: existingInbox.trim(),
          verificationRequired: yield* storage.exists(
            paths.agentmailPendingOtp,
          ),
        } satisfies InboxProvisionResult;
      }
      const value = yield* executePublicJson(
        HttpClientRequest.post(`${apiBase}/v0/agent/sign-up`),
        'signup',
        { human_email: ownerEmail, username },
      );
      const signup = yield* decodeResponse(
        Schema.Struct({
          api_key: Schema.String,
          inbox_id: Schema.String,
        }),
        'signup',
        value,
      );
      yield* storage.writeText(paths.agentmailKey, signup.api_key, 0o600);
      yield* storage.writeText(paths.agentmailInbox, signup.inbox_id, 0o600);
      yield* storage.writeJson(paths.agentmailPendingOtp, {
        ownerEmail,
        requestedAt: new Date().toISOString(),
      });
      return {
        inbox: signup.inbox_id,
        verificationRequired: true,
      } satisfies InboxProvisionResult;
    });

    const verifySignup = Effect.fn('Mailbox.verifySignup')(function* (
      otpCode: string,
    ) {
      const value = yield* executeBody(
        HttpClientRequest.post(`${apiBase}/v0/agent/verify`),
        'verifySignup',
        { otp_code: otpCode },
      );
      const verification = yield* decodeResponse(
        Schema.Struct({ verified: Schema.Boolean }),
        'verifySignup',
        value,
      );
      if (!verification.verified) {
        return yield* Effect.fail(
          mailboxFailure('verifySignup', 'verification code was not accepted'),
        );
      }
      yield* storage.remove(paths.agentmailPendingOtp);
    });

    const listCandidateThreads = Effect.fn('Mailbox.listCandidateThreads')(
      function* () {
        const { inbox } = yield* credentials();
        const threads = yield* listAllThreads('listThreads');
        const candidates = threads.filter((thread) => {
          const labels = new Set(thread.labels ?? []);
          return (
            isCollaborationSubject(thread.subject) ||
            labels.has(THREAD_LABELS.collaboration) ||
            labels.has(THREAD_LABELS.waiting) ||
            labels.has(THREAD_LABELS.working) ||
            labels.has(THREAD_LABELS.failed) ||
            labels.has(MESSAGE_LABELS.needsYou) ||
            labels.has(MESSAGE_LABELS.ready)
          );
        });
        return yield* Effect.forEach(
          candidates,
          (thread) =>
            Effect.gen(function* () {
              const labels = new Set(thread.labels ?? []);
              const discovered =
                !labels.has(THREAD_LABELS.collaboration) &&
                isCollaborationSubject(thread.subject);
              if (discovered) {
                yield* updateThread(
                  thread.thread_id,
                  [THREAD_LABELS.collaboration],
                  [],
                );
              }
              const detailUrl = `${apiBase}/v0/inboxes/${encodeURIComponent(
                inbox,
              )}/threads/${encodeURIComponent(thread.thread_id)}`;
              const value = yield* executeJson(
                HttpClientRequest.get(detailUrl),
                'getThread',
              );
              const detail = yield* decodeResponse(
                ThreadDetailWire,
                'getThread',
                value,
              );
              return discovered
                ? {
                    ...detail,
                    labels: [
                      ...(detail.labels ?? []),
                      THREAD_LABELS.collaboration,
                    ],
                  }
                : detail;
            }),
          { concurrency: 4 },
        );
      },
    );

    const listItems = Effect.fn('Mailbox.listItems')(function* () {
      const { inbox } = yield* credentials();
      const details = yield* listCandidateThreads();
      return details
        .map((thread) => classifyItem(thread, inbox))
        .filter((item) => item !== undefined)
        .sort((left, right) =>
          right.update.updatedAt.localeCompare(left.update.updatedAt),
        );
    });

    const listUpdates = Effect.fn('Mailbox.listUpdates')(function* () {
      return (yield* listItems()).map((item) => item.update);
    });

    const syncUpdates = Effect.fn('Mailbox.syncUpdates')(function* () {
      const updates = yield* listUpdates();
      const untriaged = updates.filter(
        (update) => !update.labels.includes(MESSAGE_LABELS.triaged),
      );
      yield* Effect.forEach(
        untriaged,
        (update) =>
          updateMessage(update.messageId, [MESSAGE_LABELS.triaged], []),
        { concurrency: 4, discard: true },
      );
      return updates;
    });

    const markPresented = Effect.fn('Mailbox.markPresented')(function* (
      messageIds: readonly string[],
    ) {
      yield* Effect.forEach(
        messageIds,
        (messageId) => updateMessage(messageId, [MESSAGE_LABELS.presented], []),
        { concurrency: 4, discard: true },
      );
    });

    const complete = Effect.fn('Mailbox.complete')(function* (
      messageId?: string,
      all = false,
    ) {
      const updates = yield* listUpdates();
      let selected: readonly CollaborationUpdate[];
      if (all) {
        selected = updates;
      } else if (messageId !== undefined) {
        selected = updates.filter((update) => update.messageId === messageId);
      } else if (updates.length === 1) {
        selected = updates;
      } else {
        return yield* Effect.fail(
          AmbiguousCompletionError.make({
            openCount: updates.length,
            candidates: updates.map(
              (update) => `${update.collaborator} - ${update.summary}`,
            ),
          }),
        );
      }
      yield* Effect.forEach(
        selected,
        (update) =>
          updateMessage(
            update.messageId,
            [MESSAGE_LABELS.done, 'read'],
            [
              'unread',
              MESSAGE_LABELS.needsYou,
              MESSAGE_LABELS.ready,
              MESSAGE_LABELS.presented,
            ],
          ),
        { concurrency: 4, discard: true },
      );
      return selected.map((update) => update.messageId);
    });

    const send = Effect.fn('Mailbox.send')(function* (input: SendInput) {
      const { inbox } = yield* credentials();
      const url = `${apiBase}/v0/inboxes/${encodeURIComponent(
        inbox,
      )}/messages/send`;
      const value = yield* executeBody(HttpClientRequest.post(url), 'send', {
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        text: input.text,
      });
      const result = yield* sendResult(value);
      if (input.threadLabels.length > 0) {
        yield* updateThread(result.threadId, input.threadLabels, []);
      }
      return result;
    });

    const reply = Effect.fn('Mailbox.reply')(function* (
      messageId: string,
      text: string,
      cc: readonly string[],
    ) {
      const { inbox } = yield* credentials();
      const url = `${apiBase}/v0/inboxes/${encodeURIComponent(
        inbox,
      )}/messages/${encodeURIComponent(messageId)}/reply`;
      const value = yield* executeBody(HttpClientRequest.post(url), 'reply', {
        text,
        cc,
      });
      return yield* sendResult(value);
    });

    const verifyConnection = Effect.fn('Mailbox.verifyConnection')(
      function* () {
        const { inbox } = yield* credentials();
        const url = `${apiBase}/v0/inboxes/${encodeURIComponent(inbox)}`;
        const value = yield* executeJson(
          HttpClientRequest.get(url),
          'verifyConnection',
        );
        const decoded = yield* decodeResponse(
          Schema.Struct({
            // This name mirrors AgentMail's external wire contract.
            inbox_id: Schema.String,
          }),
          'verifyConnection',
          value,
        );
        return decoded.inbox_id;
      },
    );

    const rewriteThreadLabels = Effect.fn('Mailbox.rewriteThreadLabels')(
      function* (
        inbox: string,
        thread: typeof ThreadSummaryWire.Type,
        rewrite: (
          snapshot: MailboxLabelSnapshot,
        ) => MailboxLabelRewrite | undefined,
      ) {
        const labels = new Set(thread.labels ?? []);
        const update = rewrite({
          threadId: thread.thread_id,
          threadLabels: labels,
        });
        if (update === undefined) {
          return false;
        }
        yield* updateThread(
          thread.thread_id,
          update.addThreadLabels,
          update.removeThreadLabels,
        );
        if (
          update.addMessageLabels.length === 0 &&
          update.removeMessageLabels.length === 0
        ) {
          return true;
        }
        const detailUrl = `${apiBase}/v0/inboxes/${encodeURIComponent(
          inbox,
        )}/threads/${encodeURIComponent(thread.thread_id)}`;
        const detail = yield* executeJson(
          HttpClientRequest.get(detailUrl),
          'getThreadForLabelRewrite',
        ).pipe(
          Effect.flatMap((value) =>
            decodeResponse(ThreadDetailWire, 'getThreadForLabelRewrite', value),
          ),
        );
        const latest = selectLatestMessage(detail.messages);
        if (latest !== undefined) {
          yield* updateMessage(
            latest.message_id,
            update.addMessageLabels,
            update.removeMessageLabels,
          );
        }
        return true;
      },
    );

    const rewriteLabels = Effect.fn('Mailbox.rewriteLabels')(function* (
      rewrite: (
        snapshot: MailboxLabelSnapshot,
      ) => MailboxLabelRewrite | undefined,
    ) {
      const { inbox } = yield* credentials();
      const threads = yield* listAllThreads('listThreadsForLabelRewrite');
      const changed = yield* Effect.forEach(
        threads,
        (thread) => rewriteThreadLabels(inbox, thread, rewrite),
        { concurrency: 2 },
      );
      return changed.filter((wasChanged) => wasChanged).length;
    });

    return {
      ensureInbox,
      verifySignup,
      listUpdates,
      listItems,
      syncUpdates,
      markPresented,
      complete,
      send,
      reply,
      verifyConnection,
      rewriteLabels,
    };
  }).pipe(Effect.withSpan('mailboxLayer')),
);
