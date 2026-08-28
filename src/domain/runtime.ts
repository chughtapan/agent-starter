/**
 * @file Defines adapter ownership and operational event schemas.
 */

import * as Schema from 'effect/Schema';

/** Describes one detected or installed host adapter. */
export class AdapterProbe extends Schema.Class<AdapterProbe>('AdapterProbe')({
  name: Schema.Literals(['claude', 'codex', 'openClaw']),
  detected: Schema.Boolean,
  compatible: Schema.Boolean,
  installed: Schema.Boolean,
  executable: Schema.optionalKey(Schema.String),
  configPath: Schema.optionalKey(Schema.String),
  conflict: Schema.optionalKey(Schema.String),
}) {}

/** Records a file or config entry owned by Social Harness. */
export class OwnershipEntry extends Schema.Class<OwnershipEntry>(
  'OwnershipEntry',
)({
  kind: Schema.Literals(['file', 'configEntry', 'scheduler']),
  adapter: Schema.Literals(['shared', 'claude', 'codex', 'openClaw']),
  path: Schema.String,
  identifier: Schema.optionalKey(Schema.String),
}) {}

/** Records only the host resources that Social Harness may later remove. */
export class OwnershipManifest extends Schema.Class<OwnershipManifest>(
  'OwnershipManifest',
)({
  schemaVersion: Schema.Literal(1),
  entries: Schema.Array(OwnershipEntry),
}) {}

/** Represents one append-only operational event. */
export class HarnessEvent extends Schema.Class<HarnessEvent>('HarnessEvent')({
  schemaVersion: Schema.Literal(1),
  timestamp: Schema.String,
  type: Schema.String,
  details: Schema.Record(Schema.String, Schema.Unknown),
}) {}
