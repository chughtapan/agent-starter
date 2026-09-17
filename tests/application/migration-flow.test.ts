/**
 * @file Verifies migration preservation using disposable homes and real files.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import { FastCheck } from 'effect/testing';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  Migration,
  migrationLayer,
  parseLegacyIdentity,
} from '../../src/application/migration/index.js';
import { Mailbox } from '../../src/collaboration/mail/index.js';
import { Adapters, Scheduler } from '../../src/hosts/index.js';
import { configurationLayer } from '../../src/platform/configuration/index.js';
import { DocumentTemplates } from '../../src/platform/documents/index.js';
import {
  pathsLayer,
  storageLayer,
} from '../../src/platform/persistence/index.js';

const LEGACY_IDENTITY = `# eval-agent
- I am **Eval Agent**, an AI agent run by **Eval Owner** <eval-owner@example.com>.
- My inbox is **eval-agent@agentmail.to**.
- Purpose: Inspect test fixtures.
- Since: 2026-09-01
- Autonomy: Reply within the test pair only.
- Role: collaborator
- Facilitator: **Eval Peer** <eval-peer@agentmail.to>.
`;

const migrationFixture = Effect.fn('test.migrationFixture')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({
    prefix: 'social-harness-migration-test-',
  });
  const source = `${root}/legacy`;
  const home = `${root}/owner`;
  const harness = `${home}/.social-harness`;
  const commands: string[] = [];
  const externalMutations: string[] = [];
  yield* fs.makeDirectory(source);
  yield* fs.makeDirectory(home);
  yield* fs.writeFileString(`${source}/AGENTS.md`, LEGACY_IDENTITY);
  const persistence = Layer.mergeAll(pathsLayer, storageLayer);
  const dependencies = Layer.mergeAll(
    configurationLayer.pipe(Layer.provideMerge(persistence)),
    Layer.mock(Adapters)({
      installDetected: () =>
        Effect.sync(() => {
          externalMutations.push('adapters');
          return [];
        }),
      detect: () => Effect.succeed([]),
    }),
    Layer.mock(Scheduler)({
      install: () =>
        Effect.sync(() => {
          externalMutations.push('scheduler');
          return { installed: false, mechanism: 'manual', detail: 'test' };
        }),
    }),
    Layer.mock(Mailbox)({
      verifyConnection: () => Effect.succeed('eval-agent@agentmail.to'),
      rewriteLabels: () =>
        Effect.sync(() => {
          externalMutations.push('labels');
          return 0;
        }),
    }),
    Layer.mock(DocumentTemplates)({
      agentIdentity: () => Effect.succeed('Current identity document'),
      collaborationProtocol: () => Effect.succeed('Current protocol document'),
    }),
    Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({
      string: (command) =>
        Effect.sync(() => {
          commands.push(
            command._tag === 'StandardCommand' ? command.command : 'pipeline',
          );
          return '';
        }),
      exitCode: (command) =>
        Effect.sync(() => {
          commands.push(
            command._tag === 'StandardCommand' ? command.command : 'pipeline',
          );
          return ChildProcessSpawner.ExitCode(1);
        }),
    }),
  );
  const layer = migrationLayer.pipe(
    Layer.provide(dependencies),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({
          HOME: home,
          SOCIAL_HARNESS_USER_HOME: home,
          SOCIAL_HARNESS_SCHEDULER_MODE: 'manual',
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  return { root, source, home, harness, commands, externalMutations, layer };
});

describe('migration preserves owner data before cleanup', () => {
  it.effect.prop(
    'blocks arbitrary different roster content before any mutation',
    [FastCheck.string({ maxLength: 40 })],
    ([content]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        yield* fs.makeDirectory(`${fixture.harness}/agent`, {
          recursive: true,
        });
        yield* fs.writeFileString(
          `${fixture.source}/roster.md`,
          `legacy:${content}`,
        );
        yield* fs.writeFileString(
          `${fixture.harness}/agent/roster.md`,
          `current:${content}`,
        );

        const result = yield* Effect.gen(function* () {
          return yield* (yield* Migration).apply(fixture.source, true);
        }).pipe(Effect.provide(fixture.layer), Effect.result);

        assert.equal(result._tag, 'Failure');
        assert.equal(
          yield* fs.readFileString(`${fixture.harness}/agent/roster.md`),
          `current:${content}`,
        );
        assert.equal(
          yield* fs.readFileString(`${fixture.source}/roster.md`),
          `legacy:${content}`,
        );
        assert.deepEqual(yield* fs.readDirectory(fixture.harness), ['agent']);
        assert.deepEqual(fixture.externalMutations, []);
        assert.deepEqual(fixture.commands, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'merges new nested norm files and preserves current-only files before removing the clone',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        const legacyNorm = `${fixture.source}/.agents/behaviors/review/deep`;
        const currentNorm = `${fixture.harness}/agent/.agents/behaviors/review/deep`;
        yield* fs.makeDirectory(legacyNorm, { recursive: true });
        yield* fs.makeDirectory(currentNorm, { recursive: true });
        yield* fs.writeFileString(`${legacyNorm}/shared.md`, 'shared');
        yield* fs.writeFileString(`${legacyNorm}/new.md`, 'new nested norm');
        yield* fs.writeFileString(`${currentNorm}/shared.md`, 'shared');
        yield* fs.writeFileString(`${currentNorm}/current-only.md`, 'keep');

        const result = yield* Effect.gen(function* () {
          return yield* (yield* Migration).apply(fixture.source, true);
        }).pipe(Effect.provide(fixture.layer));

        assert.isTrue(result.clean);
        assert.equal(
          yield* fs.readFileString(`${currentNorm}/new.md`),
          'new nested norm',
        );
        assert.equal(
          yield* fs.readFileString(`${currentNorm}/shared.md`),
          'shared',
        );
        assert.equal(
          yield* fs.readFileString(`${currentNorm}/current-only.md`),
          'keep',
        );
        assert.isFalse(yield* fs.exists(fixture.source));
        assert.isTrue(
          yield* fs.exists(`${fixture.harness}/state/migration.json`),
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'blocks a dangling source norm symlink even when its destination is absent',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        const norm = `${fixture.source}/.agents/behaviors/new`;
        yield* fs.makeDirectory(norm, { recursive: true });
        yield* fs.symlink(
          `${fixture.root}/missing-target`,
          `${norm}/linked.md`,
        );

        const result = yield* Effect.gen(function* () {
          return yield* (yield* Migration).apply(fixture.source, true);
        }).pipe(Effect.provide(fixture.layer), Effect.result);

        assert.equal(result._tag, 'Failure');
        assert.equal(
          yield* fs.readLink(`${norm}/linked.md`),
          `${fixture.root}/missing-target`,
        );
        assert.isFalse(yield* fs.exists(fixture.harness));
        assert.deepEqual(fixture.externalMutations, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'blocks a protected source reached through a symlink without changing it',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        const alias = `${fixture.root}/source-link`;
        yield* fs.writeFileString(`${fixture.home}/AGENTS.md`, LEGACY_IDENTITY);
        yield* fs.symlink(fixture.home, alias);

        const plan = yield* Effect.gen(function* () {
          return yield* (yield* Migration).plan(alias);
        }).pipe(Effect.provide(fixture.layer));
        const result = yield* Effect.gen(function* () {
          return yield* (yield* Migration).apply(alias, true);
        }).pipe(Effect.provide(fixture.layer), Effect.result);

        assert.isFalse(plan.clean);
        assert.include(plan.blockers, 'source root is a symbolic link');
        assert.include(
          plan.blockers,
          'source contains a protected user or runtime directory',
        );
        assert.equal(result._tag, 'Failure');
        assert.equal(
          yield* fs.readFileString(`${fixture.home}/AGENTS.md`),
          LEGACY_IDENTITY,
        );
        assert.equal(yield* fs.readLink(alias), fixture.home);
        assert.deepEqual(fixture.externalMutations, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect('blocks an ancestor containing the protected home', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fixture = yield* migrationFixture();

      const plan = yield* Effect.gen(function* () {
        return yield* (yield* Migration).plan(fixture.root);
      }).pipe(Effect.provide(fixture.layer));
      const result = yield* Effect.gen(function* () {
        return yield* (yield* Migration).apply(fixture.root, true);
      }).pipe(Effect.provide(fixture.layer), Effect.result);

      assert.include(
        plan.blockers,
        'source contains a protected user or runtime directory',
      );
      assert.equal(result._tag, 'Failure');
      assert.equal(
        yield* fs.readFileString(`${fixture.source}/AGENTS.md`),
        LEGACY_IDENTITY,
      );
      assert.isTrue(yield* fs.exists(fixture.home));
      assert.deepEqual(fixture.externalMutations, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'compares decoded identity fields independently of persisted property order',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        const identity = parseLegacyIdentity(LEGACY_IDENTITY);
        assert.isDefined(identity);
        yield* fs.makeDirectory(`${fixture.harness}/state`, {
          recursive: true,
        });
        yield* fs.writeFileString(
          `${fixture.harness}/state/identity.json`,
          JSON.stringify(
            Object.fromEntries(Object.entries(identity).reverse()),
          ),
        );

        const plan = yield* Effect.gen(function* () {
          return yield* (yield* Migration).plan(fixture.source);
        }).pipe(Effect.provide(fixture.layer));

        assert.isTrue(plan.clean);
        assert.deepEqual(plan.blockers, []);
        assert.deepEqual(fixture.externalMutations, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'preserves current identity notes and protocol when the identity matches',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        const identity = parseLegacyIdentity(LEGACY_IDENTITY);
        assert.isDefined(identity);
        yield* fs.makeDirectory(`${fixture.harness}/state`, {
          recursive: true,
        });
        yield* fs.makeDirectory(`${fixture.harness}/agent`, {
          recursive: true,
        });
        yield* fs.writeFileString(
          `${fixture.harness}/state/identity.json`,
          JSON.stringify(identity),
        );
        yield* fs.writeFileString(
          `${fixture.harness}/agent/AGENTS.md`,
          'Current owner notes',
        );
        yield* fs.writeFileString(
          `${fixture.harness}/agent/PROTOCOL.md`,
          'Current owner protocol',
        );

        yield* Effect.gen(function* () {
          return yield* (yield* Migration).apply(fixture.source, true);
        }).pipe(Effect.provide(fixture.layer));

        assert.equal(
          yield* fs.readFileString(`${fixture.harness}/agent/AGENTS.md`),
          'Current owner notes',
        );
        assert.equal(
          yield* fs.readFileString(`${fixture.harness}/agent/PROTOCOL.md`),
          'Current owner protocol',
        );
        assert.isFalse(yield* fs.exists(fixture.source));
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'blocks file-directory conflicts without copying or deleting data',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const fixture = yield* migrationFixture();
        yield* fs.writeFileString(
          `${fixture.source}/status.md`,
          'legacy status',
        );
        yield* fs.makeDirectory(`${fixture.harness}/agent/status.md`, {
          recursive: true,
        });

        const result = yield* Effect.gen(function* () {
          return yield* (yield* Migration).apply(fixture.source, true);
        }).pipe(Effect.provide(fixture.layer), Effect.result);

        assert.equal(result._tag, 'Failure');
        assert.equal(
          (yield* fs.stat(`${fixture.harness}/agent/status.md`)).type,
          'Directory',
        );
        assert.equal(
          yield* fs.readFileString(`${fixture.source}/status.md`),
          'legacy status',
        );
        assert.deepEqual(fixture.externalMutations, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
