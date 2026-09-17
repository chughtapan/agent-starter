/**
 * @file Defines the native event projections shared by transcript graders.
 */

import * as Schema from 'effect/Schema';

/** Native envelopes keep tool payloads unknown until the relevant decoder. */
export const EventValue = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optionalKey(Schema.String),
  session_id: Schema.optionalKey(Schema.String),
  thread_id: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.Unknown),
  item: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.Unknown),
  is_error: Schema.optionalKey(Schema.Boolean),
});

const ContentBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  input: Schema.optionalKey(Schema.Unknown),
  content: Schema.optionalKey(Schema.Unknown),
  id: Schema.optionalKey(Schema.String),
  tool_use_id: Schema.optionalKey(Schema.String),
  is_error: Schema.optionalKey(Schema.Boolean),
});

/** Claude emits assistant blocks and matching tool-result blocks in order. */
export const Message = Schema.Struct({ content: Schema.Array(ContentBlock) });

/** Codex command completion records distinguish stdout from assistant text. */
export const Item = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  type: Schema.String,
  text: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  aggregated_output: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(Schema.String),
  exit_code: Schema.optionalKey(Schema.NullOr(Schema.Number)),
  error: Schema.optionalKey(Schema.Unknown),
});
