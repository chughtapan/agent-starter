/**
 * @file Defines durable visibility receipts independently of mailbox state.
 */

import * as Schema from 'effect/Schema';

const Timestamp = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      const milliseconds = Date.parse(value);
      return (
        Number.isFinite(milliseconds) &&
        new Date(milliseconds).toISOString() === value
      );
    },
    { expected: 'a valid UTC timestamp in ISO format' },
  ),
);

/** Stores when and what an adapter last presented to the owner. */
export class PresentationState extends Schema.Class<PresentationState>(
  'PresentationState',
)({
  schemaVersion: Schema.Literal(1),
  lastSignature: Schema.String,
  lastPresentedAt: Timestamp,
  visibleMessageIds: Schema.optionalKey(Schema.Array(Schema.String)),
  nativeConfirmed: Schema.optionalKey(Schema.Boolean),
}) {}

/** Binds a later visibility acknowledgement to the exact retrieved snapshot. */
export class PresentationReceipt extends Schema.Class<PresentationReceipt>(
  'PresentationReceipt',
)({
  schemaVersion: Schema.Literal(1),
  signature: Schema.String,
  createdAt: Timestamp,
  issuedAtNanos: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^(0|[1-9]\d*)$/)),
  ),
  messageIds: Schema.Array(Schema.String),
  rendered: Schema.optionalKey(Schema.String),
}) {}

/** Stages exact assistant text without claiming that the owner has seen it. */
export class PendingPresentation extends Schema.Class<PendingPresentation>(
  'PendingPresentation',
)({
  schemaVersion: Schema.Literal(1),
  receiptId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  host: Schema.Literals(['claude', 'codex']),
  draftText: Schema.String,
  draftTextHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  messageIds: Schema.Array(Schema.String),
  preparedAt: Timestamp,
}) {}

/** Records one completed acknowledgement without replacing another host's. */
export class PresentationAcknowledgement extends Schema.Class<PresentationAcknowledgement>(
  'PresentationAcknowledgement',
)({
  schemaVersion: Schema.Literal(1),
  receiptId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  snapshot: PresentationReceipt,
  host: Schema.optionalKey(Schema.Literals(['claude', 'codex', 'openClaw'])),
  presentedAt: Timestamp,
  visibleMessageIds: Schema.Array(Schema.String),
  nativeConfirmed: Schema.optionalKey(Schema.Literal(true)),
  assistantTextHash: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  ),
  pendingRequestId: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  ),
}) {}
