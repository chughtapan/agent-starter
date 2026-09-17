/**
 * @file Validates stable release metadata and local software update records.
 */

import * as Schema from 'effect/Schema';

/** Only stable semantic versions can select an installed executable. */
export const StableVersion = Schema.String.check(
  Schema.isPattern(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  Schema.isTrimmed(),
);

/** The public release checksum document published by the maintained repository. */
export class ReleaseManifest extends Schema.Class<ReleaseManifest>(
  'ReleaseManifest',
)({
  schemaVersion: Schema.Literal(1),
  repository: Schema.Literal('chughtapan/agent-starter'),
  version: StableVersion,
  file: Schema.String.check(
    Schema.isPattern(/^social-harness-\d+\.\d+\.\d+\.tgz$/),
    Schema.isTrimmed(),
  ),
  sha256: Schema.String.check(
    Schema.isPattern(/^[a-f0-9]{64}$/),
    Schema.isTrimmed(),
  ),
}) {}

/** Atomic executable selection; a missing previous version means the baseline. */
export class ActiveRelease extends Schema.Class<ActiveRelease>('ActiveRelease')(
  {
    schemaVersion: Schema.Literal(1),
    current: StableVersion,
    baseline: StableVersion,
    previous: Schema.optionalKey(StableVersion),
  },
) {}

/** Retains the exact pre-transition files until activation or restoration finishes. */
export class ActivationJournal extends Schema.Class<ActivationJournal>(
  'ActivationJournal',
)({
  schemaVersion: Schema.Literal(1),
  operation: Schema.Literals(['activate', 'rollback']),
  previous: ActiveRelease,
  next: ActiveRelease,
  snapshots: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      content: Schema.optionalKey(Schema.String),
      mode: Schema.Number.check(
        Schema.isInt(),
        Schema.isGreaterThanOrEqualTo(0),
        Schema.isLessThanOrEqualTo(0o777),
      ),
    }),
  ),
}) {}

/** Failed versions are retained so automatic checks cannot repeatedly install them. */
export class SoftwareUpdateState extends Schema.Class<SoftwareUpdateState>(
  'SoftwareUpdateState',
)({
  schemaVersion: Schema.Literal(1),
  lastCheckedAt: Schema.optional(Schema.Number.check(Schema.isFinite())),
  quarantined: Schema.Array(StableVersion),
  lastError: Schema.optional(Schema.String),
}) {}

/** An actionable update failure that never includes package or credential contents. */
export class UpgradeError extends Schema.TaggedErrorClass<UpgradeError>()(
  'UpgradeError',
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

/** Machine-readable outcome for the agent-operated software update commands. */
export class UpgradeStatus extends Schema.Class<UpgradeStatus>('UpgradeStatus')(
  {
    status: Schema.Literals([
      'current',
      'available',
      'updated',
      'rolledBack',
      'disabled',
      'notDue',
      'quarantined',
      'noRelease',
    ]),
    currentVersion: StableVersion,
    candidateVersion: Schema.optionalKey(StableVersion),
    detail: Schema.String,
  },
) {}
