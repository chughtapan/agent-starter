/**
 * @file Defines typed failures that cross Social Harness service boundaries.
 */

import * as Schema from 'effect/Schema';

/** A local file operation failed. */
export class StorageError extends Schema.TaggedErrorClass<StorageError>()(
  'StorageError',
  {
    operation: Schema.String,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** A decoded configuration violates a semantic constraint. */
export class ConfigurationError extends Schema.TaggedErrorClass<ConfigurationError>()(
  'ConfigurationError',
  {
    field: Schema.String,
    reason: Schema.String,
  },
) {}

/** A packaged Nunjucks template could not be loaded or rendered. */
export class TemplateError extends Schema.TaggedErrorClass<TemplateError>()(
  'TemplateError',
  {
    template: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** AgentMail could not complete or decode an API operation. */
export class MailboxError extends Schema.TaggedErrorClass<MailboxError>()(
  'MailboxError',
  {
    operation: Schema.String,
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** A completion request did not identify one open update. */
export class AmbiguousCompletionError extends Schema.TaggedErrorClass<AmbiguousCompletionError>()(
  'AmbiguousCompletionError',
  {
    openCount: Schema.Number,
    candidates: Schema.Array(Schema.String),
  },
) {}

/** A host adapter operation could not safely proceed. */
export class AdapterError extends Schema.TaggedErrorClass<AdapterError>()(
  'AdapterError',
  {
    adapter: Schema.String,
    operation: Schema.String,
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** A background scheduler operation failed or could not be verified. */
export class SchedulerError extends Schema.TaggedErrorClass<SchedulerError>()(
  'SchedulerError',
  {
    operation: Schema.String,
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}

/** Onboarding cannot advance until the reported condition changes. */
export class OnboardingError extends Schema.TaggedErrorClass<OnboardingError>()(
  'OnboardingError',
  {
    phase: Schema.String,
    reason: Schema.String,
  },
) {}

/** Migration found user-owned data that prevents automatic cleanup. */
export class MigrationBlockedError extends Schema.TaggedErrorClass<MigrationBlockedError>()(
  'MigrationBlockedError',
  {
    reasons: Schema.Array(Schema.String),
  },
) {}
