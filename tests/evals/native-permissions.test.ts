/**
 * @file Verifies disposable-profile permission scope and settings preservation.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';

import {
  checkNativePermissions,
  hostArguments,
  initializeRoot,
  prepareNativePermissions,
  profileAt,
} from '../../evals/hosts/index.js';

const SETTINGS = Schema.fromJsonString(
  Schema.Struct({
    theme: Schema.String,
    hooks: Schema.Unknown,
    permissions: Schema.Struct({
      allow: Schema.Array(Schema.String),
      deny: Schema.Array(Schema.String),
      custom: Schema.Unknown,
    }),
  }),
);

describe('native eval permissions', () => {
  it('retains the workspace sandbox while enabling network for new and resumed Codex turns', () => {
    const profile = profileAt(
      '/isolated/social-harness-eval-permissions',
      'codex',
    );
    const start = hostArguments(profile, 'Authorized fixture work.');
    const resumed = hostArguments(
      profile,
      'Continue authorized work.',
      'exact-native-session',
    );
    assert.include(start, 'workspace-write');
    for (const args of [start, resumed]) {
      assert.include(args, 'sandbox_workspace_write.network_access=true');
      assert.notMatch(args.join(' '), /bypass|danger-full-access|ignore-rules/);
    }
  });

  it.effect.prop(
    'preserves arbitrary unrelated settings and permission fields across idempotent preparation',
    [
      FastCheck.dictionary(
        FastCheck.string({ maxLength: 12 }),
        FastCheck.jsonValue(),
        { maxKeys: 4 },
      ),
      FastCheck.dictionary(
        FastCheck.string({ maxLength: 12 }),
        FastCheck.jsonValue(),
        { maxKeys: 4 },
      ),
    ],
    ([settingsFields, permissionFields]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-permission-invariant-',
        });
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-invariant`,
        );
        const profile = profileAt(root, 'claude');
        const settingsPath = `${profile.native}/settings.json`;
        const settings = Object.fromEntries(
          Object.entries(settingsFields).map(([key, value]) => [
            `fixture_${key}`,
            value,
          ]),
        );
        const permissions = Object.fromEntries(
          Object.entries(permissionFields).map(([key, value]) => [
            `fixture_${key}`,
            value,
          ]),
        );
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({ ...settings, permissions }),
        );
        yield* prepareNativePermissions(profile);
        const first = yield* fs.readFileString(settingsPath);
        const decoded = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
        )(first);
        const decodedPermissions = yield* Schema.decodeUnknownEffect(
          Schema.Record(Schema.String, Schema.Unknown),
        )(decoded.permissions);
        for (const [key, value] of Object.entries(settings)) {
          assert.equal(JSON.stringify(decoded[key]), JSON.stringify(value));
        }
        for (const [key, value] of Object.entries(permissions)) {
          assert.equal(
            JSON.stringify(decodedPermissions[key]),
            JSON.stringify(value),
          );
        }
        yield* prepareNativePermissions(profile);
        assert.equal(yield* fs.readFileString(settingsPath), first);
      }).pipe(Effect.provide(NodeServices.layer)),
    { fastCheck: { numRuns: 25 } },
  );

  it.effect(
    'allows drafts anywhere in the owned home while preserving unrelated host settings',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-permissions-',
        });
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-permissions`,
        );
        const claude = profileAt(root, 'claude');
        const codex = profileAt(root, 'codex');
        const settingsPath = `${claude.native}/settings.json`;
        const hooks = { Stop: [{ matcher: 'preserved', hooks: [] }] };
        yield* fs.writeFileString(
          settingsPath,
          JSON.stringify({
            theme: 'light',
            hooks,
            permissions: {
              allow: ['Bash(git status)'],
              deny: ['Bash(git push *)'],
              custom: { preserved: true },
            },
          }),
        );
        const codexConfig =
          '# Owned by the native host\nmodel = "fixture-model"\n';
        yield* fs.writeFileString(`${codex.native}/config.toml`, codexConfig);
        assert.equal((yield* checkNativePermissions(claude)).status, 'blocked');
        yield* prepareNativePermissions(claude);
        yield* prepareNativePermissions(codex);
        const first = yield* fs.readFileString(settingsPath);
        const prepared = yield* Schema.decodeUnknownEffect(SETTINGS)(first);
        assert.equal(prepared.theme, 'light');
        assert.deepEqual(prepared.hooks, hooks);
        assert.deepEqual(prepared.permissions.custom, { preserved: true });
        assert.deepEqual(prepared.permissions.deny, ['Bash(git push *)']);
        assert.include(prepared.permissions.allow, 'Bash(git status)');
        assert.include(prepared.permissions.allow, `Edit(/${claude.home}/**)`);
        assert.include(
          prepared.permissions.allow,
          'Bash(social-harness present *)',
        );
        assert.include(
          prepared.permissions.allow,
          `Bash(${root}/bin/social-harness request *)`,
        );
        assert.notInclude(prepared.permissions.allow, 'Bash');
        assert.notInclude(prepared.permissions.allow, 'Bash(social-harness *)');
        assert.isFalse(
          prepared.permissions.allow.some((rule) => rule.includes('host-hook')),
        );
        assert.isFalse(
          prepared.permissions.allow.some((rule) => rule.startsWith('Write(')),
        );
        assert.equal((yield* checkNativePermissions(claude)).status, 'pass');
        yield* prepareNativePermissions(claude);
        assert.equal(yield* fs.readFileString(settingsPath), first);
        assert.equal(
          yield* fs.readFileString(`${codex.native}/config.toml`),
          codexConfig,
        );
        assert.isTrue(
          yield* fs.exists(`${claude.home}/native-permissions.json`),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'retains explicit denials and reports that they block native evaluation',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-permission-denial-',
        });
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-denial`,
        );
        const profile = profileAt(root, 'claude');
        const settingsPath = `${profile.native}/settings.json`;
        for (const permissions of [
          { deny: ['Edit'] },
          { ask: ['Bash'] },
          { defaultMode: 'bypassPermissions' },
        ]) {
          yield* fs.writeFileString(
            settingsPath,
            JSON.stringify({ permissions }),
          );
          yield* prepareNativePermissions(profile);
          assert.equal(
            (yield* checkNativePermissions(profile)).status,
            'blocked',
          );
          const preserved = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(
              Schema.Struct({
                permissions: Schema.Record(Schema.String, Schema.Unknown),
              }),
            ),
          )(yield* fs.readFileString(settingsPath));
          for (const [key, value] of Object.entries(permissions)) {
            assert.deepEqual(preserved.permissions[key], value);
          }
        }
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'leaves malformed existing permissions untouched and reports a blocked prerequisite',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-permission-invalid-',
        });
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-invalid`,
        );
        const profile = profileAt(root, 'claude');
        const settingsPath = `${profile.native}/settings.json`;
        const existing =
          '{"permissions":{"allow":"Bash"},"theme":"preserved"}\n';
        yield* fs.writeFileString(settingsPath, existing);
        const result = yield* prepareNativePermissions(profile).pipe(
          Effect.result,
        );
        assert.equal(result._tag, 'Failure');
        assert.equal(yield* fs.readFileString(settingsPath), existing);
        assert.equal(
          (yield* checkNativePermissions(profile)).status,
          'blocked',
        );
        assert.isFalse(
          yield* fs.exists(`${profile.home}/native-permissions.json`),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});
