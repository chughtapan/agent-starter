/**
 * @file Defines expected failures owned by this module.
 */

import * as Schema from 'effect/Schema';

/** A packaged Nunjucks template could not be loaded or rendered. */
export class TemplateError extends Schema.TaggedErrorClass<TemplateError>()(
  'TemplateError',
  {
    template: Schema.String,
  },
) {
  override get message(): string {
    return `Template: could not load or render ${this.template}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}
