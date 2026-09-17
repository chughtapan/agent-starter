/**
 * @file Decodes the installed Codex app-server hook and config API boundaries.
 */

import * as Schema from 'effect/Schema';

/** Hook fields needed to authorize an exact native trust edit. */
export const NativeHook = Schema.Struct({
  key: Schema.String,
  currentHash: Schema.String.check(Schema.isMinLength(1)),
  eventName: Schema.String,
  handlerType: Schema.String,
  command: Schema.optionalKey(Schema.String),
  source: Schema.String,
  sourcePath: Schema.String,
  matcher: Schema.optionalKey(Schema.NullOr(Schema.String)),
  timeoutSec: Schema.Number,
  enabled: Schema.Boolean,
  isManaged: Schema.Boolean,
  async: Schema.optionalKey(Schema.Boolean),
  trustStatus: Schema.Literals(['managed', 'untrusted', 'trusted', 'modified']),
});

/** Native metadata is the authority for current hashes and saved trust. */
export const HooksResponse = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      cwd: Schema.String,
      hooks: Schema.Array(NativeHook),
      errors: Schema.Array(Schema.Unknown),
      warnings: Schema.Array(Schema.String),
    }),
  ),
});

/** Only leaf trust records are written through the native config API. */
export const TrustEdit = Schema.Struct({
  keyPath: Schema.String,
  value: Schema.String,
  mergeStrategy: Schema.Literal('upsert'),
});

/** Confirms which native configuration file accepted the edit. */
export const WriteResponse = Schema.Struct({
  filePath: Schema.String,
  status: Schema.Literals(['ok', 'okOverridden']),
  version: Schema.String,
});

/** The server reports its selected profile during the initialization handshake. */
export const InitializeResponse = Schema.Struct({
  codexHome: Schema.String,
  userAgent: Schema.String,
});

/** Notifications may arrive between sequential, numeric request responses. */
export const Envelope = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Number),
    result: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(
      Schema.Struct({ code: Schema.Number, message: Schema.String }),
    ),
    method: Schema.optionalKey(Schema.String),
  }),
);
