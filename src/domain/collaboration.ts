/**
 * @file Defines the current collaboration state shown to users.
 */

import * as Schema from 'effect/Schema';

/** The five states that can appear on the update board. */
export const UpdateKind = Schema.Literals([
  'needsYou',
  'ready',
  'waiting',
  'working',
  'failed',
]);

/** A decoded user-facing state name. */
export type UpdateKind = typeof UpdateKind.Type;

/** Represents one open collaboration update. */
export class CollaborationUpdate extends Schema.Class<CollaborationUpdate>(
  'CollaborationUpdate',
)({
  threadId: Schema.String,
  messageId: Schema.String,
  kind: UpdateKind,
  collaborator: Schema.String,
  summary: Schema.String,
  updatedAt: Schema.String,
  labels: Schema.Array(Schema.String),
  unread: Schema.Boolean,
  subject: Schema.String,
}) {}

/** Stores the latest successfully decoded mailbox view. */
export class MailboxCache extends Schema.Class<MailboxCache>('MailboxCache')({
  schemaVersion: Schema.Literal(1),
  lastSync: Schema.String,
  lastError: Schema.optionalKey(Schema.String),
  updates: Schema.Array(CollaborationUpdate),
}) {}

/** Stores when and what an adapter last presented to the owner. */
export class PresentationState extends Schema.Class<PresentationState>(
  'PresentationState',
)({
  schemaVersion: Schema.Literal(1),
  lastSignature: Schema.String,
  lastPresentedAt: Schema.String,
}) {}

/** Contains the full untrusted message behind a collaboration update. */
export class CollaborationItem extends Schema.Class<CollaborationItem>(
  'CollaborationItem',
)({
  update: CollaborationUpdate,
  senderEmail: Schema.String,
  text: Schema.String,
  attachments: Schema.Array(Schema.String),
}) {}
