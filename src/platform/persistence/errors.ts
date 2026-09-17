/**
 * @file Defines expected failures owned by this module.
 */

import * as Schema from 'effect/Schema';

/** A local file operation failed. */
export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  'StorageError',
  {
    operation: Schema.String,
    path: Schema.String,
  },
) {
  override get message(): string {
    return `${this.operation}: local file operation failed at ${this.path}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}
