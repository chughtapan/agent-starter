/**
 * @file Verifies additive host-hook installation and ownership detection.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  HarnessConfig,
  makeDefaultConfig,
} from '../../src/domain/configuration.js';
import {
  mergeOwnershipEntries,
  OwnershipEntry,
  OwnershipManifest,
} from '../../src/domain/runtime.js';
import {
  Adapters,
  adaptersLayer,
  addSessionHook,
  hasSessionHook,
} from '../../src/hosts/index.js';
import { Configuration } from '../../src/platform/configuration/index.js';
import { DocumentTemplates } from '../../src/platform/documents/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';

function adapterFixture(configured?: HarnessConfig) {
  const config = configured ?? makeDefaultConfig();
  const files = new Map<string, unknown>();
  const writes: string[] = [];
  const storage = Layer.mock(Storage)({
    readJson: (path) => Effect.sync(() => files.get(path)),
    readText: (path) =>
      Effect.sync(() => {
        const value = files.get(path);
        return typeof value === 'string' ? value : undefined;
      }),
    writeText: (path, value) =>
      Effect.sync(() => {
        files.set(path, value);
        writes.push(path);
      }),
    writeJson: (path, value) =>
      Effect.sync(() => {
        files.set(path, value);
        writes.push(path);
      }),
  });
  const spawner = Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
    string: (command) =>
      Effect.succeed(
        command._tag === 'StandardCommand' && command.command === 'which'
          ? `/test/bin/${command.args[0] ?? ''}`
          : '1.0.0',
      ),
  });
  const dependencies = Layer.mergeAll(
    pathsLayer,
    storage,
    spawner,
    Layer.mock(Configuration)({ load: () => Effect.succeed(config) }),
    Layer.mock(DocumentTemplates)({
      hostSkill: () => Effect.succeed('# Current skill\n'),
    }),
  );
  const fixtureLayer = adaptersLayer.pipe(
    Layer.provide(dependencies),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: '/test/owner' })),
    ),
    Layer.provide(NodeServices.layer),
  );
  return { files, writes, layer: fixtureLayer };
}

describe('host hook merge', () => {
  it.prop(
    'preserves arbitrary unrelated settings across repeated reconciliation',
    [FastCheck.dictionary(FastCheck.string(), FastCheck.jsonValue())],
    ([settings]) => {
      const original = { preferences: settings };
      const installed = addSessionHook(original);
      assert.deepEqual(installed.preferences, settings);
      assert.deepEqual(addSessionHook(installed), installed);
    },
  );

  it('preserves existing hooks and settings', () => {
    const existing = {
      model: 'configured-model',
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'orca-hook', timeout: 10 }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'timeline-hook' }] }],
      },
    };
    const updated = addSessionHook(existing);
    const encoded = JSON.stringify(updated);

    assert.strictEqual(updated.model, 'configured-model');
    assert.include(encoded, 'orca-hook');
    assert.include(encoded, 'timeline-hook');
    assert.include(encoded, 'social-harness host-hook --event SessionStart');
    assert.include(
      encoded,
      'social-harness host-hook --event UserPromptSubmit',
    );
    assert.include(encoded, 'social-harness host-hook --event PostToolUse');
    assert.include(encoded, 'social-harness host-hook --event Stop');
    assert.isTrue(hasSessionHook(updated));
  });

  it('is idempotent', () => {
    const once = addSessionHook({});
    assert.deepEqual(addSessionHook(once), once);
  });

  it('binds installed hooks to their native host and replaces older provenance', () => {
    const legacy = addSessionHook({ preferences: { retained: true } });
    const claude = addSessionHook(legacy, 'claude');
    const codex = addSessionHook(claude, 'codex');
    assert.isTrue(hasSessionHook(claude, 'claude'));
    assert.isFalse(hasSessionHook(claude, 'codex'));
    assert.isTrue(hasSessionHook(codex, 'codex'));
    assert.isFalse(hasSessionHook(codex, 'claude'));
    assert.notInclude(JSON.stringify(codex), '--host claude');
    assert.deepStrictEqual(codex.preferences, { retained: true });
    assert.deepStrictEqual(addSessionHook(codex, 'codex'), codex);
  });

  it('does not report an absent hook as installed', () => {
    assert.isFalse(hasSessionHook(undefined));
    assert.isFalse(hasSessionHook({ hooks: {} }));
  });

  it('does not confuse descriptive text with an executable hook', () => {
    const config = {
      hooks: {
        SessionStart: [
          { description: 'social-harness host-hook --event SessionStart' },
        ],
      },
    };
    assert.isFalse(hasSessionHook(config));
    assert.isTrue(hasSessionHook(addSessionHook(config)));
  });

  it('replaces legacy handlers without removing neighboring tool hooks', () => {
    const config = {
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [
              {
                type: 'command',
                command: 'social-harness updates --if-needed',
              },
              { type: 'command', command: 'other-tool' },
            ],
          },
        ],
      },
    };
    const encoded = JSON.stringify(addSessionHook(config));
    assert.notInclude(encoded, 'social-harness updates --if-needed');
    assert.include(encoded, 'other-tool');
    assert.include(encoded, 'startup');
    assert.isTrue(hasSessionHook(addSessionHook(config)));
  });

  it('rejects malformed hook containers before a merge can discard settings', () => {
    assert.throws(() =>
      addSessionHook({ hooks: { SessionStart: { command: 'other-tool' } } }),
    );
    assert.throws(() => addSessionHook({ hooks: [] }));
  });

  it('records a shared skill once even when two adapters own it', () => {
    const first = OwnershipEntry.make({
      kind: 'file',
      adapter: 'codex',
      path: '/test/shared/SKILL.md',
    });
    const second = OwnershipEntry.make({
      kind: 'file',
      adapter: 'openClaw',
      path: '/test/shared/SKILL.md',
    });
    const current = OwnershipEntry.make({
      kind: 'file',
      adapter: 'shared',
      path: '/test/shared/SKILL.md',
    });
    assert.deepEqual(mergeOwnershipEntries([first, second], [current]), [
      current,
    ]);
  });
});

describe('adapter resource reconciliation', () => {
  it.effect.prop(
    'ownership of another path cannot authorize replacing the shared skill',
    [
      FastCheck.string().filter(
        (value) =>
          value !== '/test/owner/.agents/skills/social-harness/SKILL.md',
      ),
    ],
    ([ownedPath]) => {
      const fixture = adapterFixture();
      const sharedPath = '/test/owner/.agents/skills/social-harness/SKILL.md';
      fixture.files.set(sharedPath, '# User-owned shared instructions\n');
      fixture.files.set(
        '/test/owner/.social-harness/state/ownership.json',
        OwnershipManifest.make({
          schemaVersion: 1,
          entries: [
            OwnershipEntry.make({
              kind: 'file',
              adapter: 'shared',
              path: ownedPath,
            }),
          ],
        }),
      );
      return Effect.gen(function* () {
        const adapters = yield* Adapters;
        assert.strictEqual(
          (yield* adapters.installDetected().pipe(Effect.result))._tag,
          'Failure',
        );
        assert.strictEqual(
          fixture.files.get(sharedPath),
          '# User-owned shared instructions\n',
        );
        assert.deepStrictEqual(fixture.writes, []);
      }).pipe(Effect.provide(fixture.layer));
    },
    { fastCheck: { numRuns: 25 } },
  );
  it.effect(
    'refreshes an owned Codex skill while OpenClaw remains disabled',
    () => {
      const defaults = makeDefaultConfig();
      const fixture = adapterFixture(
        Schema.decodeUnknownSync(HarnessConfig)({
          ...Schema.encodeSync(HarnessConfig)(defaults),
          adapters: { ...defaults.adapters, openClaw: { mode: 'disabled' } },
        }),
      );
      const sharedPath = '/test/owner/.agents/skills/social-harness/SKILL.md';
      fixture.files.set(sharedPath, '# Previous packaged skill\n');
      fixture.files.set(
        '/test/owner/.social-harness/state/ownership.json',
        OwnershipManifest.make({
          schemaVersion: 1,
          entries: [
            OwnershipEntry.make({
              kind: 'file',
              adapter: 'shared',
              path: sharedPath,
            }),
          ],
        }),
      );
      return Effect.gen(function* () {
        const adapters = yield* Adapters;
        const installed = yield* adapters.installDetected();
        assert.strictEqual(fixture.files.get(sharedPath), '# Current skill\n');
        assert.isTrue(
          installed.some((probe) => probe.name === 'codex' && probe.installed),
        );
        assert.isFalse(
          installed.find((probe) => probe.name === 'openClaw')?.compatible,
        );
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    'preserves differing unowned shared instructions with enabled hosts',
    () => {
      const fixture = adapterFixture();
      const sharedPath = '/test/owner/.agents/skills/social-harness/SKILL.md';
      fixture.files.set(
        sharedPath,
        '# User-owned collaboration instructions\n',
      );
      return Effect.gen(function* () {
        const adapters = yield* Adapters;
        const result = yield* adapters.installDetected().pipe(Effect.result);
        assert.strictEqual(result._tag, 'Failure');
        assert.strictEqual(
          fixture.files.get(sharedPath),
          '# User-owned collaboration instructions\n',
        );
        assert.deepStrictEqual(fixture.writes, []);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    'previews detected adapters without writing host or ownership files',
    () => {
      const fixture = adapterFixture();
      return Effect.gen(function* () {
        const adapters = yield* Adapters;
        const probes = yield* adapters.installDetected({ dryRun: true });
        assert.strictEqual(probes.length, 3);
        assert.isTrue(
          probes.every((probe) => probe.detected && !probe.installed),
        );
        assert.deepEqual(fixture.writes, []);
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    'preserves non-owned hooks and records the shared skill only once',
    () => {
      const fixture = adapterFixture();
      const configPath = '/test/owner/.claude/settings.json';
      fixture.files.set(configPath, {
        model: 'owner-model',
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'owner-hook' }] },
          ],
        },
      });
      return Effect.gen(function* () {
        const adapters = yield* Adapters;
        yield* adapters.installDetected();
        const probes = yield* adapters.detect();
        assert.isTrue(
          probes.every(
            (probe) => probe.installed && probe.capability === 'unverified',
          ),
        );
        const config = JSON.stringify(fixture.files.get(configPath));
        assert.include(config, 'owner-model');
        assert.include(config, 'owner-hook');
        assert.isTrue(hasSessionHook(fixture.files.get(configPath), 'claude'));
        assert.isTrue(
          hasSessionHook(
            fixture.files.get('/test/owner/.codex/hooks.json'),
            'codex',
          ),
        );
        const manifest = yield* Schema.decodeUnknownEffect(OwnershipManifest)(
          fixture.files.get('/test/owner/.social-harness/state/ownership.json'),
        );
        assert.strictEqual(
          manifest.entries.filter(
            (entry) =>
              entry.path ===
              '/test/owner/.agents/skills/social-harness/SKILL.md',
          ).length,
          1,
        );
      }).pipe(Effect.provide(fixture.layer));
    },
  );

  it.effect(
    'blocks shared skill drift when a disabled adapter also uses that file',
    () => {
      const defaults = makeDefaultConfig();
      const fixture = adapterFixture(
        HarnessConfig.make({
          schemaVersion: defaults.schemaVersion,
          polling: defaults.polling,
          updates: defaults.updates,
          notifications: defaults.notifications,
          execution: defaults.execution,
          backup: defaults.backup,
          softwareUpdates: defaults.softwareUpdates,
          adapters: { ...defaults.adapters, codex: { mode: 'disabled' } },
        }),
      );
      fixture.files.set(
        '/test/owner/.agents/skills/social-harness/SKILL.md',
        '# Customized disabled adapter skill\n',
      );
      return Effect.gen(function* () {
        const adapters = yield* Adapters;
        assert.strictEqual(
          (yield* adapters.installDetected().pipe(Effect.result))._tag,
          'Failure',
        );
        assert.deepEqual(fixture.writes, []);
      }).pipe(Effect.provide(fixture.layer));
    },
  );
});
