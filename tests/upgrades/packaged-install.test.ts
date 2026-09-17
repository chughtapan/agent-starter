/**
 * @file Installs the emitted npm package outside source with an offline dependency fixture.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  HarnessConfig,
  makeDefaultConfig,
} from '../../src/domain/configuration.js';
import {
  ActivationJournal,
  ActiveRelease,
  SoftwareUpdateState,
} from '../../src/domain/upgrades.js';

const sourceManifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  files: Schema.optionalKey(Schema.Array(Schema.String)),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
});

const readManifest = Effect.fn('test.packageManifest')(function* (
  filename: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem
    .readFileString(filename)
    .pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(Schema.fromJsonString(sourceManifest)),
      ),
    );
});

const seedDependencies = Effect.fn('test.offlineDependencies')(function* (
  sourceRoot: string,
  destination: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pending = [sourceRoot];
  const copied = new Map<string, string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      break;
    }
    const manifest = yield* readManifest(path.join(current, 'package.json'));
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const require = createRequire(path.join(current, 'package.json'));
      const candidates = require.resolve.paths(name) ?? [];
      const manifests = yield* Effect.filter(
        candidates.map((directory) =>
          path.join(directory, name, 'package.json'),
        ),
        (filename) => fileSystem.exists(filename),
      );
      const manifestPath = manifests[0];
      if (manifestPath === undefined) {
        return yield* Effect.die(
          `The installed dependency fixture is missing ${name}.`,
        );
      }
      const dependencyRoot = yield* fileSystem.realPath(
        path.dirname(manifestPath),
      );
      const dependency = yield* readManifest(manifestPath);
      const previous = copied.get(name);
      if (previous !== undefined) {
        assert.strictEqual(
          previous,
          dependency.version,
          `The offline fixture needs separate versions of ${name}.`,
        );
        continue;
      }
      copied.set(name, dependency.version);
      const target = path.join(destination, name);
      yield* fileSystem.makeDirectory(path.dirname(target), {
        recursive: true,
      });
      yield* fileSystem.copy(dependencyRoot, target);
      pending.push(dependencyRoot);
    }
  }
  return Object.fromEntries(
    [...copied.keys()].map((name) => [
      name,
      `file:${path.join(destination, name)}`,
    ]),
  );
});

describe('packaged installation', () => {
  it(
    'installs packaged templates and recovers from failed startup outside the source tree',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));
        const root = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-package-test-',
        });
        const packageRoot = path.join(root, 'package');
        const prefix = path.join(root, 'installed');
        const userHome = path.join(root, 'user');
        const harnessHome = path.join(userHome, '.social-harness');
        yield* fileSystem.makeDirectory(packageRoot, { recursive: true });
        yield* fileSystem.makeDirectory(prefix, { recursive: true });
        yield* fileSystem.makeDirectory(harnessHome, { recursive: true });
        const npmrc = path.join(root, 'npmrc');
        yield* fileSystem.writeFileString(
          npmrc,
          'offline=true\nignore-scripts=true\n',
        );
        const hostBin = path.join(root, 'host-bin');
        yield* fileSystem.makeDirectory(hostBin);
        yield* Effect.forEach(
          ['claude', 'codex', 'openclaw'],
          (host) =>
            fileSystem.writeFileString(
              path.join(hostBin, host),
              `#!${process.execPath}\nconsole.log('${host} package-test fixture');\n`,
              { mode: 0o755 },
            ),
          { concurrency: 1 },
        );
        const inheritedPath = yield* Config.string('PATH');
        const environment = {
          PATH: `${hostBin}:${inheritedPath}`,
          HOME: userHome,
          SOCIAL_HARNESS_USER_HOME: userHome,
          SOCIAL_HARNESS_HOME: harnessHome,
          AGENTMAIL_HOME: path.join(userHome, '.agentmail'),
          CLAUDE_CONFIG_DIR: path.join(userHome, '.claude'),
          CODEX_HOME: path.join(userHome, '.codex'),
          SOCIAL_HARNESS_SCHEDULER_MODE: 'manual',
          AGENTMAIL_API_KEY: '',
          AGENTMAIL_INBOX: '',
          NPM_CONFIG_CACHE: path.join(root, 'npm-cache'),
          NPM_CONFIG_USERCONFIG: npmrc,
          NPM_CONFIG_GLOBALCONFIG: path.join(root, 'global-npmrc'),
        };
        const defaults =
          yield* Schema.encodeEffect(HarnessConfig)(makeDefaultConfig());
        yield* fileSystem.writeFileString(
          path.join(harnessHome, 'config.json'),
          JSON.stringify({
            ...defaults,
            softwareUpdates: { enabled: false, checkInterval: 'PT24H' },
          }),
        );
        const run = Effect.fn('test.packageCommand')(function* (
          executable: string,
          args: readonly string[],
          cwd: string,
        ) {
          const child = yield* spawner.spawn(
            ChildProcess.make(executable, args, {
              cwd,
              env: environment,
              extendEnv: false,
              stdin: 'ignore',
              stdout: 'pipe',
              stderr: 'pipe',
            }),
          );
          const [output, errors, exitCode] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(child.stdout)),
              Stream.mkString(Stream.decodeText(child.stderr)),
              child.exitCode,
            ],
            { concurrency: 3 },
          );
          assert.strictEqual(
            Number(exitCode),
            0,
            `${executable} ${args.join(' ')} failed:\n${errors}\n${output}`,
          );
          return output;
        });
        const manifest = yield* readManifest(
          path.join(sourceRoot, 'package.json'),
        );
        yield* fileSystem.copyFile(
          path.join(sourceRoot, 'package.json'),
          path.join(packageRoot, 'package.json'),
        );
        yield* Effect.forEach(
          (manifest.files ?? []).filter((file) => file !== 'dist'),
          (file) =>
            fileSystem.copy(
              path.join(sourceRoot, file),
              path.join(packageRoot, file),
            ),
          { concurrency: 1 },
        );
        yield* run(
          process.execPath,
          [
            path.join(sourceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
            '-p',
            path.join(sourceRoot, 'tsconfig.build.json'),
            '--outDir',
            path.join(packageRoot, 'dist'),
          ],
          sourceRoot,
        );
        const dependencies = yield* seedDependencies(
          sourceRoot,
          path.join(root, 'dependencies', 'node_modules'),
        );
        yield* fileSystem.writeFileString(
          path.join(prefix, 'package.json'),
          JSON.stringify({ private: true, dependencies }),
        );
        const packedOutput = yield* run(
          'npm',
          ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
          packageRoot,
        );
        const packed = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Array(Schema.Struct({ filename: Schema.String })),
          ),
        )(packedOutput);
        const archive = packed[0]?.filename;
        assert.isDefined(archive);
        if (archive === undefined) {
          return;
        }
        yield* run(
          'npm',
          [
            'install',
            '--prefix',
            prefix,
            '--offline',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--omit=optional',
            '--legacy-peer-deps',
            '--package-lock=false',
            path.join(root, archive),
          ],
          root,
        );
        const installedRoot = path.join(
          prefix,
          'node_modules',
          'social-harness',
        );
        const installedBootstrap = path.join(
          installedRoot,
          'dist',
          'upgrades',
          'bootstrap.js',
        );
        const installedRealPath =
          yield* fileSystem.realPath(installedBootstrap);
        const installedCommand = path.join(
          prefix,
          'node_modules',
          '.bin',
          'social-harness',
        );
        assert.strictEqual(
          yield* fileSystem.realPath(installedCommand),
          installedRealPath,
        );
        const fixtureRealPath = yield* fileSystem.realPath(root);
        assert.isTrue(installedRealPath.startsWith(fixtureRealPath));
        assert.isFalse(installedRealPath.startsWith(sourceRoot));
        assert.include(
          yield* run(installedCommand, ['--help'], root),
          'upgrade',
        );
        assert.include(
          yield* run(installedCommand, ['--version'], root),
          manifest.version,
        );
        const repair = yield* run(
          installedCommand,
          ['repair', '--adapters-only'],
          root,
        );
        assert.include(repair, 'claude');
        const sharedSkill = yield* fileSystem.readFileString(
          path.join(
            userHome,
            '.agents',
            'skills',
            'social-harness',
            'SKILL.md',
          ),
        );
        assert.include(sharedSkill, 'name: social-harness');
        assert.include(sharedSkill, 'untrusted');
        const runtime = path.join(harnessHome, 'runtime');
        const brokenCli = path.join(
          runtime,
          'versions',
          '99.0.0',
          'node_modules',
          'social-harness',
          'dist',
          'cli.js',
        );
        yield* fileSystem.makeDirectory(path.dirname(brokenCli), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(brokenCli, 'process.exitCode = 1;\n');
        yield* fileSystem.writeFileString(
          path.join(runtime, 'active-release.json'),
          JSON.stringify({
            schemaVersion: 1,
            current: '99.0.0',
            baseline: manifest.version,
          }),
        );
        assert.include(
          yield* run(installedCommand, ['--version'], root),
          manifest.version,
        );
        const recovered = yield* fileSystem
          .readFileString(path.join(runtime, 'active-release.json'))
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(ActiveRelease)),
            ),
          );
        assert.strictEqual(recovered.current, manifest.version);
        const updateState = yield* fileSystem
          .readFileString(
            path.join(harnessHome, 'state', 'software-updates.json'),
          )
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(SoftwareUpdateState),
              ),
            ),
          );
        assert.deepEqual(updateState.quarantined, ['99.0.0']);
        const interruptedCli = path.join(
          runtime,
          'versions',
          '99.0.1',
          'node_modules',
          'social-harness',
          'dist',
          'cli.js',
        );
        yield* fileSystem.makeDirectory(path.dirname(interruptedCli), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(
          interruptedCli,
          'console.log("UNCOMMITTED_CANDIDATE_EXECUTED");\n',
        );
        const interruptedSelection = ActiveRelease.make({
          schemaVersion: 1,
          current: '99.0.1',
          baseline: manifest.version,
        });
        const settingsPath = path.join(userHome, '.claude', 'settings.json');
        const originalSettings = yield* fileSystem.readFileString(settingsPath);
        const journalPath = path.join(runtime, 'activation-journal.json');
        yield* fileSystem.writeFileString(
          journalPath,
          JSON.stringify(
            ActivationJournal.make({
              schemaVersion: 1,
              operation: 'activate',
              previous: recovered,
              next: interruptedSelection,
              snapshots: [
                { path: settingsPath, content: originalSettings, mode: 0o600 },
              ],
            }),
          ),
        );
        yield* fileSystem.writeFileString(
          settingsPath,
          '{"partialCandidateSettings":true}\n',
        );
        yield* fileSystem.writeFileString(
          path.join(runtime, 'active-release.json'),
          JSON.stringify(interruptedSelection),
        );
        const recoveredOutput = yield* run(
          installedCommand,
          ['--version'],
          root,
        );
        assert.include(recoveredOutput, manifest.version);
        assert.notInclude(recoveredOutput, 'UNCOMMITTED_CANDIDATE_EXECUTED');
        assert.strictEqual(
          yield* fileSystem.readFileString(settingsPath),
          originalSettings,
        );
        assert.isFalse(yield* fileSystem.exists(journalPath));
        assert.isFalse(
          yield* fileSystem.exists(
            path.join(userHome, 'Library', 'LaunchAgents'),
          ),
        );
        assert.isFalse(
          yield* fileSystem.exists(path.join(userHome, '.agentmail', 'key')),
        );
      }).pipe(
        Effect.timeout('110 seconds'),
        Effect.scoped,
        Effect.provide(NodeServices.layer),
        Effect.runPromise,
      ),
    120_000,
  );
});
