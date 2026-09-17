/**
 * @file Tests the fixed release origin and checksum boundary without network or npm.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Sink from 'effect/Sink';
import * as Stream from 'effect/Stream';
import { FastCheck } from 'effect/testing';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { createHash } from 'node:crypto';

import { ReleaseManifest, StableVersion } from '../../src/domain/upgrades.js';
import {
  pathsLayer,
  storageLayer,
} from '../../src/platform/persistence/index.js';
import {
  ReleasePackages,
  releasePackagesLayer,
} from '../../src/upgrades/index.js';

interface CommandRecord {
  readonly executable: string;
  readonly args: readonly string[];
  readonly options: {
    readonly cwd?: string | undefined;
    readonly env?: Readonly<Record<string, string | undefined>> | undefined;
    readonly extendEnv?: boolean | undefined;
  };
}

const writeCandidatePackage = Effect.fn('test.writeCandidatePackage')(
  function* (
    fileSystem: FileSystem.FileSystem,
    candidate: string,
    version: string,
  ) {
    const assets = [
      'dist/cli.js',
      'dist/upgrades/bootstrap.js',
      'templates/agent/AGENTS.md.njk',
      'templates/agent/PROTOCOL.md.njk',
      'templates/agent/social-harness.SKILL.md.njk',
      'templates/agent/hook-context.txt.njk',
      'templates/onboarding/introduction.txt.njk',
      'templates/onboarding/roster.md.njk',
      'templates/scheduler/launch-agent.plist.njk',
    ];
    yield* fileSystem.makeDirectory(candidate, { recursive: true });
    yield* fileSystem.writeFileString(
      `${candidate}/package.json`,
      JSON.stringify({
        name: 'social-harness',
        version,
        bin: { 'social-harness': 'dist/upgrades/bootstrap.js' },
      }),
    );
    yield* Effect.forEach(
      assets,
      (asset) => {
        const destination = `${candidate}/${asset}`;
        return fileSystem
          .makeDirectory(destination.replace(/\/[^/]+$/, ''), {
            recursive: true,
          })
          .pipe(
            Effect.andThen(fileSystem.writeFileString(destination, 'fixture')),
          );
      },
      { concurrency: 1, discard: true },
    );
  },
);

describe('release package trust boundary', () => {
  it.prop(
    'never accepts a path separator in an executable version',
    [FastCheck.string(), FastCheck.string()],
    ([prefix, suffix]) => !Schema.is(StableVersion)(`${prefix}/${suffix}`),
  );
  it('rejects prereleases and directory traversal in executable version selectors', () => {
    const accepts = Schema.is(StableVersion);
    assert.isFalse(accepts('0.5.0-beta.1'));
    assert.isFalse(accepts('../../other'));
    assert.isFalse(accepts('v0.5.0'));
    assert.isFalse(accepts('0.5.0\n'));
  });

  it.effect('rejects a release that redirects to an unrelated origin', () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: 'social-harness-release-test-',
      });
      const requestedUrls: string[] = [];
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          requestedUrls.push(request.url);
          return HttpClientResponse.fromWeb(
            request,
            new Response(null, {
              status: 302,
              headers: { location: 'https://example.com/arbitrary-code.tgz' },
            }),
          );
        }),
      );
      yield* Effect.gen(function* () {
        const packages = yield* ReleasePackages;
        const result = yield* packages.latest().pipe(Effect.result);
        assert.strictEqual(result._tag, 'Failure');
        assert.deepEqual(requestedUrls, [
          'https://api.github.com/repos/chughtapan/agent-starter/releases/latest',
        ]);
      }).pipe(Effect.provide(releaseFixture(directory, client)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'treats a missing stable release as no release instead of choosing a branch',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-release-test-',
        });
        const client = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(null, { status: 404 }),
            ),
          ),
        );
        yield* Effect.gen(function* () {
          const packages = yield* ReleasePackages;
          assert.isUndefined(yield* packages.latest());
        }).pipe(Effect.provide(releaseFixture(directory, client)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'refuses a mismatched archive before any installer process starts',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-release-test-',
        });
        const client = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response('altered release archive'),
            ),
          ),
        );
        const release = ReleaseManifest.make({
          schemaVersion: 1,
          repository: 'chughtapan/agent-starter',
          version: '0.5.0',
          file: 'social-harness-0.5.0.tgz',
          sha256: '0'.repeat(64),
        });
        yield* Effect.gen(function* () {
          const packages = yield* ReleasePackages;
          const result = yield* packages
            .stage(release, directory)
            .pipe(Effect.result);
          assert.strictEqual(result._tag, 'Failure');
          if (result._tag === 'Failure') {
            assert.strictEqual(result.failure._tag, 'UpgradeError');
            assert.strictEqual(result.failure.operation, 'checksum');
          }
          assert.deepEqual(yield* fileSystem.readDirectory(directory), []);
        }).pipe(Effect.provide(releaseFixture(directory, client)));
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'uses private script-free installation before verifying the staged candidate',
    () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: 'social-harness-release-test-',
        });
        const archive = new TextEncoder().encode('verified test archive');
        const release = ReleaseManifest.make({
          schemaVersion: 1,
          repository: 'chughtapan/agent-starter',
          version: '0.5.0',
          file: 'social-harness-0.5.0.tgz',
          sha256: createHash('sha256').update(archive).digest('hex'),
        });
        const client = HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(request, new Response(archive)),
          ),
        );
        const candidate = `${directory}/node_modules/social-harness`;
        yield* writeCandidatePackage(fileSystem, candidate, release.version);
        const commands: CommandRecord[] = [];

        yield* Effect.gen(function* () {
          const packages = yield* ReleasePackages;
          assert.strictEqual(
            yield* packages.stage(release, directory),
            candidate,
          );
        }).pipe(Effect.provide(releaseFixture(directory, client, commands)));

        const npm = commands.find((command) => command.executable === 'npm');
        assert.isDefined(npm);
        if (npm === undefined) {
          return;
        }
        assert.include(npm.args, '--ignore-scripts');
        assert.include(npm.args, '--userconfig');
        assert.include(npm.args, '--globalconfig');
        assert.include(npm.args, '--cache');
        assert.strictEqual(npm.options.cwd, directory);
        assert.strictEqual(npm.options.extendEnv, false);
        assert.strictEqual(npm.options.env?.HOME, directory);
        const verification = commands.filter(
          (command) => command.executable === process.execPath,
        );
        assert.deepEqual(
          verification.map((command) => command.args.at(-1)),
          ['--help', '--version', 'show'],
        );
        assert.isTrue(
          verification.every(
            (command) =>
              command.options.extendEnv === false &&
              command.options.env?.AGENTMAIL_API_KEY === '' &&
              command.options.env?.AGENTMAIL_INBOX === '',
          ),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );
});

function releaseFixture(
  directory: string,
  client: HttpClient.HttpClient,
  commands?: CommandRecord[],
) {
  const persistence = Layer.mergeAll(pathsLayer, storageLayer).pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: directory })),
    ),
  );
  return releasePackagesLayer.pipe(
    Layer.provide(
      Layer.succeed(
        ChildProcessSpawner.ChildProcessSpawner,
        ChildProcessSpawner.make((command) => {
          if (commands === undefined) {
            return Effect.die(
              'A rejected release must never start npm or candidate code.',
            );
          }
          if (command._tag !== 'StandardCommand') {
            return Effect.die('Release staging must not use a shell pipeline.');
          }
          return Effect.sync(() => {
            commands.push({
              executable: command.command,
              args: command.args,
              options: command.options,
            });
            return ChildProcessSpawner.makeHandle({
              pid: ChildProcessSpawner.ProcessId(1),
              exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
              isRunning: Effect.succeed(false),
              kill: () => Effect.void,
              stdin: Sink.drain,
              stdout: Stream.empty,
              stderr: Stream.empty,
              all: Stream.empty,
              getInputFd: () => Sink.drain,
              getOutputFd: () => Stream.empty,
              unref: Effect.succeed(Effect.void),
            });
          });
        }),
      ),
    ),
    Layer.provide(persistence),
    Layer.provide(Layer.succeed(HttpClient.HttpClient)(client)),
  );
}
