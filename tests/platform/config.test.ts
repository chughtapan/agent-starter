/**
 * @file Verifies configuration decoding at the ConfigProvider and Schema edge.
 */

import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';

import { makeDefaultConfig } from '../../src/domain/configuration.js';
import { harnessConfig } from '../../src/platform/configuration/index.js';

describe('configuration contract', () => {
  it.effect('decodes the documented defaults through ConfigProvider', () =>
    Effect.gen(function* () {
      const expected = makeDefaultConfig();
      const actual = yield* harnessConfig.parse(
        ConfigProvider.fromUnknown(expected),
      );
      assert.deepEqual(actual, expected);
    }),
  );

  it.effect('rejects invalid duration values at the Schema boundary', () =>
    Effect.gen(function* () {
      const current = makeDefaultConfig();
      const invalid = {
        schemaVersion: current.schemaVersion,
        polling: { interval: '15 minutes' },
        updates: current.updates,
        notifications: current.notifications,
        execution: current.execution,
        adapters: current.adapters,
        backup: current.backup,
      };
      const result = yield* harnessConfig
        .parse(ConfigProvider.fromUnknown(invalid))
        .pipe(Effect.result);
      assert.strictEqual(result._tag, 'Failure');
    }),
  );
});
