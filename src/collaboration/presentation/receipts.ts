/**
 * @file Persists exact-snapshot receipts independently of user completion.
 */

import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { createHash } from 'node:crypto';

import type { AdapterProbe } from '../../domain/runtime.js';
import {
  PendingPresentation,
  PresentationAcknowledgement,
  PresentationReceipt,
  PresentationState,
} from '../../domain/presentation.js';
import {
  Paths,
  Storage,
  StorageError,
} from '../../platform/persistence/index.js';
import { Mailbox, MailboxError } from '../mail/index.js';
import { PresentationError, Receipts } from './api/index.js';

/** Reduces immutable visibility records, preserving simultaneous host updates. */
export const receiptsLayer = Layer.effect(Receipts)(
  Effect.gen(function* () {
    const paths = yield* Paths;
    const storage = yield* Storage;
    const mailbox = yield* Mailbox;

    const acknowledgements = `${paths.state}/acknowledgements`;
    const pendingPresentations = `${paths.state}/pending-presentations`;

    const readLegacy = Effect.fn('Receipts.readLegacy')(function* () {
      const value = yield* storage.readJson(paths.presentation);
      if (value === undefined) {
        return undefined;
      }
      return yield* Schema.decodeUnknownEffect(PresentationState)(value).pipe(
        Effect.mapError(() =>
          StorageError.make({
            operation: 'decodePresentation',
            path: paths.presentation,
          }),
        ),
      );
    });

    const readAcknowledgement = Effect.fn('Receipts.readAcknowledgement')(
      function* (path: string) {
        const value = yield* storage.readJson(path);
        const record = yield* Schema.decodeUnknownEffect(
          PresentationAcknowledgement,
        )(value).pipe(
          Effect.mapError(() =>
            StorageError.make({
              operation: 'decodeAcknowledgement',
              path,
            }),
          ),
        );
        if (
          record.nativeConfirmed === true &&
          ((record.host !== 'claude' && record.host !== 'codex') ||
            record.assistantTextHash === undefined ||
            record.pendingRequestId === undefined)
        ) {
          return yield* Effect.fail(
            StorageError.make({ operation: 'decodeAcknowledgement', path }),
          );
        }
        return record;
      },
    );

    const read = Effect.fn('Receipts.read')(function* (
      host?: AdapterProbe['name'],
    ) {
      // Legacy state has no host provenance or snapshot issue order. Preserve
      // its visibility globally, then let new acknowledgements define order.
      const legacy = host === undefined ? yield* readLegacy() : undefined;
      const files = yield* storage.listDirectory(acknowledgements);
      const records = yield* Effect.forEach(
        [...files]
          .sort((left, right) => left.localeCompare(right, 'en'))
          .filter((file) => /^[a-f0-9]{64}\.json$/.test(file)),
        (file) => readAcknowledgement(`${acknowledgements}/${file}`),
        { concurrency: 1 },
      );
      const eligible =
        host === undefined
          ? records.filter((record) => !isUnconfirmedNative(record))
          : records.filter((record) => record.host === host);
      return (
        reduceAcknowledgements(eligible, legacy?.visibleMessageIds ?? []) ??
        legacy
      );
    });

    const issue = Effect.fn('Receipts.issue')(function* (
      signature: string,
      messageIds: readonly string[],
      rendered?: string,
    ) {
      const now = yield* Clock.currentTimeNanos;
      const receipt = PresentationReceipt.make({
        schemaVersion: 1,
        signature,
        createdAt: new Date(Number(now / 1_000_000n)).toISOString(),
        issuedAtNanos: now.toString(),
        messageIds,
        ...(rendered === undefined ? {} : { rendered }),
      });
      const id = digest(receipt);
      yield* storage.writeJsonIfAbsent(
        `${paths.state}/receipts/${id}.json`,
        receipt,
      );
      return id;
    });

    const readReceipt = Effect.fn('Receipts.readReceipt')(function* (
      id: string,
    ) {
      if (!/^[a-f0-9]{64}$/.test(id)) {
        return yield* Effect.fail(
          MailboxError.make({
            operation: 'presented',
            reason: 'invalid presentation receipt',
          }),
        );
      }
      const receiptPath = `${paths.state}/receipts/${id}.json`;
      const value = yield* storage.readJson(receiptPath);
      return yield* Schema.decodeUnknownEffect(PresentationReceipt)(value).pipe(
        Effect.mapError(() =>
          MailboxError.make({
            operation: 'presented',
            reason: 'presentation receipt was not found or is invalid',
          }),
        ),
      );
    });

    const recordAcknowledgement = Effect.fn('Receipts.recordAcknowledgement')(
      function* (
        acknowledgementId: string,
        record: PresentationAcknowledgement,
      ) {
        const acknowledgementPath = `${acknowledgements}/${acknowledgementId}.json`;
        if (yield* storage.exists(acknowledgementPath)) {
          yield* readAcknowledgement(acknowledgementPath);
          return;
        }
        const open = yield* mailbox.listUpdates();
        const visible = record.visibleMessageIds.filter((id) =>
          open.some((item) => item.messageId === id),
        );
        yield* mailbox.markPresented(visible);
        const visibleRecord = PresentationAcknowledgement.make({
          ...Schema.encodeSync(PresentationAcknowledgement)(record),
          visibleMessageIds: visible,
        });
        const recorded = yield* storage.writeJsonIfAbsent(
          acknowledgementPath,
          visibleRecord,
        );
        return recorded ? visibleRecord : undefined;
      },
    );

    const acknowledge = Effect.fn('Receipts.acknowledge')(function* (
      id: string,
      messageIds: readonly string[],
      host?: AdapterProbe['name'],
    ) {
      const receipt = yield* readReceipt(id);
      const selected = yield* selectMessages(receipt, messageIds);
      yield* recordAcknowledgement(
        digest([id, selected, host ?? null]),
        PresentationAcknowledgement.make({
          schemaVersion: 1,
          receiptId: id,
          snapshot: receipt,
          ...(host === undefined ? {} : { host }),
          presentedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          visibleMessageIds: selected,
        }),
      );
    });

    const readPending = Effect.fn('Receipts.readPending')(function* (
      requestId: string,
    ) {
      const path = `${pendingPresentations}/${requestId}.json`;
      const pending = yield* Schema.decodeUnknownEffect(PendingPresentation)(
        yield* storage.readJson(path),
      ).pipe(
        Effect.mapError(() =>
          StorageError.make({ operation: 'decodePendingPresentation', path }),
        ),
      );
      if (
        pending.draftTextHash !==
          textDigest(normalizeText(pending.draftText)) ||
        requestId !== pendingId(pending)
      ) {
        return yield* Effect.fail(
          StorageError.make({ operation: 'decodePendingPresentation', path }),
        );
      }
      return pending;
    });

    const prepare = Effect.fn('Receipts.prepare')(function* (
      receiptId: string,
      host: 'claude' | 'codex',
      draftText: string,
      messageIds: readonly string[],
    ) {
      const receipt = yield* readReceipt(receiptId);
      const selected = yield* selectMessages(receipt, messageIds);
      yield* validateDraft(receipt, draftText, selected);
      const pending = PendingPresentation.make({
        schemaVersion: 1,
        receiptId,
        host,
        draftText,
        draftTextHash: textDigest(normalizeText(draftText)),
        messageIds: selected,
        preparedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      });
      const requestId = pendingId(pending);
      yield* storage.writeJsonIfAbsent(
        `${pendingPresentations}/${requestId}.json`,
        pending,
      );
      yield* readPending(requestId);
      return {
        requestId,
        receiptId,
        host,
        draftTextHash: pending.draftTextHash,
      };
    });

    const confirm = Effect.fn('Receipts.confirm')(function* (
      host: 'claude' | 'codex',
      lastAssistantMessage: string,
    ) {
      const text = normalizeText(lastAssistantMessage);
      if (text.length === 0) {
        return [];
      }
      const files = yield* storage.listDirectory(pendingPresentations);
      const pending = yield* Effect.forEach(
        files.filter((file) => /^[a-f0-9]{64}\.json$/.test(file)),
        (file) => readPending(file.slice(0, -5)),
        { concurrency: 1 },
      );
      const matching = pending
        .filter(
          (record) =>
            record.host === host &&
            text.includes(normalizeText(record.draftText)),
        )
        .sort(
          (left, right) =>
            normalizeText(right.draftText).length -
              normalizeText(left.draftText).length ||
            right.preparedAt.localeCompare(left.preparedAt, 'en'),
        );
      const confirmed: PresentationAcknowledgement[] = [];
      for (const record of matching) {
        const receipt = yield* readReceipt(record.receiptId);
        const selected = yield* selectMessages(receipt, record.messageIds);
        yield* validateDraft(receipt, record.draftText, selected);
        const acknowledgement = yield* recordAcknowledgement(
          digest([record.receiptId, selected, host, 'native']),
          PresentationAcknowledgement.make({
            schemaVersion: 1,
            receiptId: record.receiptId,
            snapshot: receipt,
            host,
            presentedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
            visibleMessageIds: selected,
            nativeConfirmed: true,
            assistantTextHash: textDigest(text),
            pendingRequestId: pendingId(record),
          }),
        );
        if (acknowledgement !== undefined) {
          confirmed.push(acknowledgement);
        }
      }
      return confirmed;
    });

    const failure =
      (operation: string) =>
      (error: PresentationError | StorageError | MailboxError) =>
        error._tag === 'PresentationError'
          ? error
          : PresentationError.make({
              operation,
              reason: 'visibility state could not be read or recorded',
            });
    return Receipts.of({
      read: (host) => read(host).pipe(Effect.mapError(failure('read'))),
      issue: (signature, messageIds, rendered) =>
        issue(signature, messageIds, rendered).pipe(
          Effect.mapError(failure('issue')),
        ),
      acknowledge: (id, messageIds, host) =>
        acknowledge(id, messageIds, host).pipe(
          Effect.mapError(failure('acknowledge')),
        ),
      prepare: (receiptId, host, draftText, messageIds) =>
        prepare(receiptId, host, draftText, messageIds).pipe(
          Effect.mapError(failure('prepare')),
        ),
      confirm: (host, text) =>
        confirm(host, text).pipe(Effect.mapError(failure('confirm'))),
    });
  }).pipe(Effect.withSpan('receiptsLayer')),
);

function reduceAcknowledgements(
  records: readonly PresentationAcknowledgement[],
  legacyVisibleMessageIds: readonly string[],
): PresentationState | undefined {
  const visible = new Set(legacyVisibleMessageIds);
  let latest: PresentationAcknowledgement | undefined;
  for (const record of records) {
    if (!isUnconfirmedNative(record)) {
      for (const messageId of record.visibleMessageIds) {
        visible.add(messageId);
      }
    }
    if (latest === undefined) {
      latest = record;
      continue;
    }
    if (isNewerAcknowledgement(record, latest)) {
      latest = record;
    }
  }
  if (latest === undefined) {
    return undefined;
  }
  return PresentationState.make({
    schemaVersion: 1,
    lastSignature: latest.snapshot.signature,
    lastPresentedAt: latest.presentedAt,
    nativeConfirmed: latest.nativeConfirmed === true,
    visibleMessageIds: [...visible].sort((left, right) =>
      left.localeCompare(right, 'en'),
    ),
  });
}

function isUnconfirmedNative(record: PresentationAcknowledgement): boolean {
  return (
    (record.host === 'claude' || record.host === 'codex') &&
    record.nativeConfirmed !== true
  );
}

function pendingId(pending: PendingPresentation): string {
  return digest([
    pending.receiptId,
    pending.host,
    normalizeText(pending.draftText),
    pending.messageIds,
  ]);
}

function selectMessages(
  receipt: PresentationReceipt,
  messageIds: readonly string[],
): Effect.Effect<readonly string[], PresentationError> {
  if (messageIds.some((id) => !receipt.messageIds.includes(id))) {
    return Effect.fail(
      PresentationError.make({
        operation: 'presented',
        reason: 'a message was not part of the retrieved snapshot',
      }),
    );
  }
  return Effect.succeed(
    [...new Set(messageIds)].sort((left, right) =>
      left.localeCompare(right, 'en'),
    ),
  );
}

function validateDraft(
  receipt: PresentationReceipt,
  draftText: string,
  messageIds: readonly string[],
): Effect.Effect<void, PresentationError> {
  if (
    receipt.rendered === undefined ||
    normalizeText(receipt.rendered).length === 0
  ) {
    return Effect.fail(
      PresentationError.make({
        operation: 'prepare',
        reason:
          'retrieve a fresh updates receipt before staging native presentation',
      }),
    );
  }
  const normalized = normalizeText(draftText);
  const board = normalizeText(receipt.rendered);
  if (!normalized.includes(board)) {
    return Effect.fail(
      PresentationError.make({
        operation: 'prepare',
        reason: 'the draft must include the retrieved rendered board exactly',
      }),
    );
  }
  if (
    messageIds.length > 0 &&
    !/[\p{L}\p{N}]/u.test(normalized.replace(board, ''))
  ) {
    return Effect.fail(
      PresentationError.make({
        operation: 'prepare',
        reason: 'include the selected result text beyond the retrieved board',
      }),
    );
  }
  return Effect.void;
}

function isNewerAcknowledgement(
  record: PresentationAcknowledgement,
  previous: PresentationAcknowledgement,
): boolean {
  return (
    compareSnapshots(record, previous) > 0 ||
    (record.receiptId === previous.receiptId &&
      Date.parse(record.presentedAt) > Date.parse(previous.presentedAt))
  );
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeText(value: string): string {
  return value.replaceAll('\r\n', '\n').trim();
}

function textDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareSnapshots(
  left: PresentationAcknowledgement,
  right: PresentationAcknowledgement,
): number {
  const issuedAt = (receipt: PresentationReceipt) =>
    receipt.issuedAtNanos === undefined
      ? BigInt(Date.parse(receipt.createdAt)) * 1_000_000n
      : BigInt(receipt.issuedAtNanos);
  const difference = issuedAt(left.snapshot) - issuedAt(right.snapshot);
  if (difference !== 0n) {
    return difference < 0n ? -1 : 1;
  }
  // Truly simultaneous snapshots have no meaningful time order. Resolve ties
  // consistently so directory enumeration and acknowledgement order cannot win.
  return left.receiptId.localeCompare(right.receiptId, 'en');
}
