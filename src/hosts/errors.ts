/**
 * @file Defines expected failures owned by this module.
 */

import * as Schema from 'effect/Schema';

/** A host adapter operation could not safely proceed. */
export class AdapterError extends Schema.TaggedErrorClass<AdapterError>()(
  'AdapterError',
  {
    adapter: Schema.String,
    operation: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.adapter} ${this.operation}: ${this.reason}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}

/** A background scheduler operation failed or could not be verified. */
export class SchedulerError extends Schema.TaggedErrorClass<SchedulerError>()(
  'SchedulerError',
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
