/**
 * @file Reads native Stop confirmations as a separate presentation oracle.
 */

import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';

import { EvaluationError, Host, type Profile } from '../domain/index.js';

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Timestamp = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      const parsed = Date.parse(value);
      return (
        Number.isFinite(parsed) && new Date(parsed).toISOString() === value
      );
    },
    { expected: 'a valid canonical UTC timestamp' },
  ),
);

/** A native acknowledgement binds an exact assistant event to a receipt. */
export class NativeConfirmation extends Schema.Class<NativeConfirmation>(
  'NativeConfirmation',
)({
  schemaVersion: Schema.Literal(1),
  receiptId: Digest,
  host: Host,
  presentedAt: Timestamp,
  visibleMessageIds: Schema.Array(Schema.String),
  nativeConfirmed: Schema.Literal(true),
  assistantTextHash: Digest,
  pendingRequestId: Digest,
}) {}

const Acknowledgement = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  receiptId: Digest,
  host: Schema.optionalKey(Schema.Literals(['claude', 'codex', 'openClaw'])),
  presentedAt: Timestamp,
  visibleMessageIds: Schema.Array(Schema.String),
  nativeConfirmed: Schema.optionalKey(Schema.Boolean),
  assistantTextHash: Schema.optionalKey(Digest),
  pendingRequestId: Schema.optionalKey(Digest),
});

/**
 * Reads only confirmations created during this native turn in this host's ledger.
 * @param profile Isolated native profile whose Stop hook writes the ledger.
 * @param since Earliest permitted confirmation time in epoch milliseconds.
 * @returns Valid native confirmations; legacy and other-host records do not count.
 */
export const readNativeConfirmations = Effect.fn(
  'evals.readNativeConfirmations',
)(
  function* (profile: Profile, since: number) {
    const fs = yield* FileSystem.FileSystem;
    const directory = `${profile.harness}/state/acknowledgements`;
    if (!(yield* fs.exists(directory))) {
      return [];
    }
    const records: NativeConfirmation[] = [];
    for (const filename of yield* fs.readDirectory(directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) {
        continue;
      }
      const record = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Acknowledgement),
      )(yield* fs.readFileString(`${directory}/${filename}`));
      const timestamp = Date.parse(record.presentedAt);
      if (
        record.nativeConfirmed !== true ||
        record.host !== profile.host ||
        timestamp < since ||
        timestamp > Date.now()
      ) {
        continue;
      }
      records.push(
        yield* Schema.decodeUnknownEffect(NativeConfirmation)(record),
      );
    }
    return records;
  },
  Effect.mapError(() =>
    EvaluationError.make({
      operation: 'native-confirmation',
      reason:
        'The isolated native presentation confirmation ledger could not be read or validated.',
    }),
  ),
);
