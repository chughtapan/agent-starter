/**
 * @file Defines expected failures owned by this module.
 */

import * as Schema from 'effect/Schema';

/** AgentMail could not complete or decode an API operation. */
export class MailboxError extends Schema.TaggedErrorClass<MailboxError>()(
  'MailboxError',
  {
    operation: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.reason}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}

/** A completion request did not identify one open update. */
export class AmbiguousCompletionError extends Schema.TaggedErrorClass<AmbiguousCompletionError>()(
  'AmbiguousCompletionError',
  {
    openCount: Schema.Number,
    candidates: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Complete: choose one of ${String(this.openCount)} open updates or explicitly complete all.`;
  }
}
