/**
 * @file Verifies native profile paths and disposable user-home isolation.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { Paths, pathsLayer } from '../../src/platform/persistence/index.js';

function pathsFor(environment: Readonly<Record<string, string>>) {
  return pathsLayer.pipe(
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown(environment)),
    ),
    Layer.provide(NodeServices.layer),
  );
}

describe('host profile paths', () => {
  it.effect('keeps ordinary installations under their actual home', () =>
    Effect.gen(function* () {
      const paths = yield* Paths;
      assert.strictEqual(paths.home, '/owner/.social-harness');
      assert.strictEqual(paths.claudeHome, '/owner/.claude');
      assert.strictEqual(paths.codexHome, '/owner/.codex');
    }).pipe(Effect.provide(pathsFor({ HOME: '/owner' }))),
  );

  it.effect('isolates every derived directory without changing HOME', () =>
    Effect.gen(function* () {
      const paths = yield* Paths;
      assert.strictEqual(paths.userHome, '/test/owner');
      assert.strictEqual(paths.home, '/test/owner/.social-harness');
      assert.strictEqual(paths.agentmailHome, '/test/owner/.agentmail');
      assert.strictEqual(paths.claudeHome, '/test/owner/.claude');
      assert.strictEqual(paths.codexHome, '/test/owner/.codex');
      assert.strictEqual(paths.agentsHome, '/test/owner/.agents');
      assert.strictEqual(paths.openClawHome, '/test/owner/.openclaw');
    }).pipe(
      Effect.provide(
        pathsFor({ HOME: '/owner', SOCIAL_HARNESS_USER_HOME: '/test/owner' }),
      ),
    ),
  );

  it.effect('respects explicit native and runtime profile directories', () =>
    Effect.gen(function* () {
      const paths = yield* Paths;
      assert.strictEqual(paths.claudeHome, '/profiles/claude');
      assert.strictEqual(paths.codexHome, '/profiles/codex');
      assert.strictEqual(paths.home, '/test/runtime');
      assert.strictEqual(paths.agentmailHome, '/test/mail');
    }).pipe(
      Effect.provide(
        pathsFor({
          HOME: '/owner',
          CLAUDE_CONFIG_DIR: '/profiles/claude',
          CODEX_HOME: '/profiles/codex',
          SOCIAL_HARNESS_HOME: '/test/runtime',
          AGENTMAIL_HOME: '/test/mail',
        }),
      ),
    ),
  );
});
