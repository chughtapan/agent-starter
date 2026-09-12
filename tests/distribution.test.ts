/**
 * @file Verifies the public package manifest and aligned Effect runtime.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, layer } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import { fileURLToPath } from 'node:url';

const stringRecord = Schema.Record(Schema.String, Schema.String);
const packageManifest = Schema.Struct({
  bin: stringRecord,
  dependencies: stringRecord,
  devDependencies: stringRecord,
  files: Schema.Array(Schema.String),
});

layer(NodeServices.layer)('package contract', (it) => {
  it.effect('pins one Effect runtime for package consumers', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const source = yield* fileSystem.readFileString(
        fileURLToPath(new URL('../package.json', import.meta.url)),
      );
      const manifest = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(packageManifest),
      )(source);
      const effectVersion = manifest.dependencies.effect;

      assert.isDefined(effectVersion);
      assert.strictEqual(
        manifest.dependencies['@effect/platform-node'],
        effectVersion,
      );
      assert.strictEqual(
        manifest.dependencies['@effect/platform-node-shared'],
        effectVersion,
      );
      assert.strictEqual(
        manifest.devDependencies['@effect/vitest'],
        effectVersion,
      );
    }),
  );

  it.effect('publishes the CLI and document templates', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const source = yield* fileSystem.readFileString(
        fileURLToPath(new URL('../package.json', import.meta.url)),
      );
      const manifest = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(packageManifest),
      )(source);

      assert.strictEqual(manifest.bin['social-harness'], 'dist/cli.js');
      assert.include(manifest.files, 'templates');
    }),
  );
});
