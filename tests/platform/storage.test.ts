/**
 * @file Verifies immutable JSON publication using real private temporary files.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';

import { Storage, storageLayer } from '../../src/platform/persistence/index.js';

/* eslint sonarjs/no-empty-test-file: "off" -- Effect's it.effect and it.effect.prop execute tests but are not recognized by this syntax-only rule. */

describe('immutable storage', () => {
  it.effect.prop(
    'publishes exactly one complete value when independent writers race',
    [FastCheck.array(FastCheck.string(), { minLength: 2, maxLength: 8 })],
    ([values]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({
          prefix: 'social-harness-storage-test-',
        });
        const first = yield* Storage.pipe(Effect.provide(storageLayer));
        const second = yield* Storage.pipe(Effect.provide(storageLayer));
        const path = `${directory}/immutable.json`;
        const results = yield* Effect.forEach(
          values,
          (value, index) =>
            (index % 2 === 0 ? first : second).writeJsonIfAbsent(path, {
              index,
              value,
            }),
          { concurrency: 4 },
        );
        assert.equal(results.filter(Boolean).length, 1);
        const stored = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ index: Schema.Number, value: Schema.String }),
        )(yield* first.readJson(path));
        assert.equal(stored.value, values[stored.index]);
        assert.isTrue(results[stored.index]);
        assert.isFalse(
          yield* second.writeJsonIfAbsent(path, { replaced: true }),
        );
        assert.deepEqual(yield* second.readJson(path), stored);
        assert.deepEqual(yield* first.listDirectory(directory), [
          'immutable.json',
        ]);
        assert.equal((yield* fs.stat(path)).mode & 0o777, 0o600);
        assert.equal((yield* fs.stat(directory)).mode & 0o777, 0o700);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect('distinguishes a missing directory from an unreadable path', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: 'social-harness-storage-test-',
      });
      const storage = yield* Storage.pipe(Effect.provide(storageLayer));
      assert.deepEqual(yield* storage.listDirectory(`${directory}/absent`), []);
      const path = `${directory}/plain-file`;
      yield* storage.writeText(path, 'not a directory');
      assert.equal(
        (yield* storage.listDirectory(path).pipe(Effect.result))._tag,
        'Failure',
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
