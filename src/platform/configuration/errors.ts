/**
 * @file Defines expected failures owned by this module.
 */

import * as Schema from 'effect/Schema';

/** A decoded configuration violates a semantic constraint. */
export class ConfigurationError extends Schema.TaggedErrorClass<ConfigurationError>()(
  'ConfigurationError',
  {
    field: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.field}: ${this.reason}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}
