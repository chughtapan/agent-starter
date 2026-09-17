/**
 * @file Downloads fixed-repository releases and verifies staged package output.
 */

import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientRequest from 'effect/unstable/http/HttpClientRequest';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  ReleaseManifest,
  StableVersion,
  UpgradeError,
} from '../domain/upgrades.js';
import { Paths, Storage } from '../platform/persistence/index.js';
import { ReleasePackages } from './ports.js';

const REPOSITORY = 'chughtapan/agent-starter';
const RELEASE_FEED = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

interface PackageCommandOptions {
  readonly environment?: Record<string, string>;
  readonly workingDirectory?: string;
  readonly inheritEnvironment?: boolean;
}

const githubRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  prerelease: Schema.Boolean,
});

const packageManifest = Schema.Struct({
  name: Schema.Literal('social-harness'),
  version: StableVersion,
  bin: Schema.Struct({ 'social-harness': Schema.String }),
});

/** Captures platform dependencies once for the release package boundary. */
export const releasePackagesLayer = Layer.effect(ReleasePackages)(
  Effect.gen(function* () {
    const storage = yield* Storage;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const paths = yield* Paths;
    const httpClient = yield* HttpClient.HttpClient;
    const executableSearchPath = yield* Config.string('PATH').pipe(
      Config.withDefault(path.dirname(process.execPath)),
    );

    const validateReleaseUrl = Effect.fn('Upgrades.validateReleaseUrl')(
      function* (value: string) {
        const url = yield* Effect.try({
          try: () => new URL(value),
          catch: () => failure('download', 'the release URL is invalid'),
        });
        const allowed =
          url.protocol === 'https:' &&
          url.username === '' &&
          url.password === '' &&
          ((url.origin === 'https://api.github.com' &&
            url.pathname === `/repos/${REPOSITORY}/releases/latest`) ||
            (url.origin === 'https://github.com' &&
              url.pathname.startsWith(`/${REPOSITORY}/releases/download/`)) ||
            (url.origin === 'https://release-assets.githubusercontent.com' &&
              url.pathname.startsWith('/github-production-release-asset/')));
        if (!allowed) {
          return yield* Effect.fail(
            failure(
              'download',
              'the release redirected outside the trusted GitHub release origins',
            ),
          );
        }
      },
    );

    const client = httpClient.pipe(
      HttpClient.transform((response, request) =>
        validateReleaseUrl(request.url).pipe(Effect.andThen(response)),
      ),
      HttpClient.followRedirects(3),
      HttpClient.mapRequest(
        HttpClientRequest.setHeaders({
          Accept: 'application/vnd.github+json',
          'User-Agent': 'social-harness-updater',
        }),
      ),
    );

    const download = Effect.fn('Upgrades.download')(function* (
      url: string,
      limit: number,
    ) {
      const response = yield* client.get(url).pipe(
        Effect.timeout('30 seconds'),
        Effect.mapError(() =>
          failure(
            'download',
            'the release asset could not be downloaded from GitHub',
          ),
        ),
      );
      if (response.status !== 200) {
        return yield* Effect.fail(
          failure(
            'download',
            `the release asset returned HTTP ${String(response.status)}`,
          ),
        );
      }
      const declaredLength = Number(response.headers['content-length'] ?? 0);
      if (declaredLength > limit) {
        return yield* Effect.fail(
          failure(
            'download',
            'the release asset exceeds the allowed download size',
          ),
        );
      }
      const chunks: Uint8Array[] = [];
      let byteCount = 0;
      yield* Stream.runForEach(response.stream, (chunk) => {
        byteCount += chunk.length;
        if (byteCount > limit) {
          return Effect.fail(
            failure(
              'download',
              'the release asset exceeds the allowed download size',
            ),
          );
        }
        chunks.push(chunk);
        return Effect.void;
      }).pipe(
        Effect.timeout('30 seconds'),
        Effect.mapError((error) =>
          error instanceof UpgradeError
            ? error
            : failure('download', 'the release asset body is incomplete'),
        ),
      );
      const bytes = new Uint8Array(byteCount);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    });

    const runCommand = Effect.fn('Upgrades.runCommand')(function* (
      executable: string,
      arguments_: readonly string[],
      operation: string,
      options: PackageCommandOptions = {},
    ) {
      const exitCode = yield* spawner
        .exitCode(
          ChildProcess.make(executable, arguments_, {
            ...(options.workingDirectory === undefined
              ? {}
              : { cwd: options.workingDirectory }),
            ...(options.environment === undefined
              ? {}
              : {
                  env: options.environment,
                  extendEnv: options.inheritEnvironment ?? true,
                }),
            stdin: 'ignore',
            stdout: 'ignore',
            stderr: 'ignore',
          }),
        )
        .pipe(
          Effect.timeout('5 minutes'),
          Effect.mapError(() =>
            failure(
              operation,
              `${executable === 'npm' ? 'npm installation' : 'package verification or repair'} could not finish; the current release is retained`,
            ),
          ),
        );
      if (Number(exitCode) !== 0) {
        return yield* Effect.fail(
          failure(
            operation,
            `the ${operation} command exited with ${String(exitCode)}`,
          ),
        );
      }
    });

    const runningVersion = Effect.fn('Upgrades.runningVersion')(function* () {
      const source = yield* storage.readJson(
        fileURLToPath(new URL('../../package.json', import.meta.url)),
      );
      const manifest = yield* Schema.decodeUnknownEffect(packageManifest)(
        source,
      ).pipe(
        Effect.mapError(() =>
          failure('package', 'the running package manifest is invalid'),
        ),
      );
      return manifest.version;
    });

    const verifyPackage = Effect.fn('Upgrades.verifyPackage')(function* (
      packageRoot: string,
      version: string,
      scratchRoot: string,
    ) {
      const manifest = yield* storage
        .readJson(path.join(packageRoot, 'package.json'))
        .pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(packageManifest)),
          Effect.mapError(() =>
            failure('verify', 'the staged package manifest is invalid'),
          ),
        );
      if (
        manifest.version !== version ||
        manifest.bin['social-harness'] !== 'dist/upgrades/bootstrap.js'
      ) {
        return yield* Effect.fail(
          failure(
            'verify',
            'the staged package version or stable bootstrap entry does not match',
          ),
        );
      }
      const requiredAssets = [
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
      yield* Effect.forEach(
        requiredAssets,
        Effect.fn('Upgrades.verifyAsset')(function* (asset) {
          const content = yield* storage.readText(
            path.join(packageRoot, asset),
          );
          if (content === undefined || content.trim().length === 0) {
            return yield* Effect.fail(
              failure('verify', `the staged package is missing ${asset}`),
            );
          }
        }),
        { concurrency: 1 },
      );
      const cli = path.join(packageRoot, 'dist', 'cli.js');
      const environment = {
        HOME: scratchRoot,
        SOCIAL_HARNESS_USER_HOME: scratchRoot,
        SOCIAL_HARNESS_HOME: path.join(scratchRoot, 'smoke-harness'),
        AGENTMAIL_HOME: path.join(scratchRoot, 'smoke-agentmail'),
        CLAUDE_CONFIG_DIR: path.join(scratchRoot, 'claude'),
        CODEX_HOME: path.join(scratchRoot, 'codex'),
        AGENTMAIL_API_KEY: '',
        AGENTMAIL_INBOX: '',
      };
      yield* runCommand(process.execPath, [cli, '--help'], 'verify', {
        environment,
        inheritEnvironment: false,
      });
      yield* runCommand(process.execPath, [cli, '--version'], 'verify', {
        environment,
        inheritEnvironment: false,
      });
      yield* runCommand(process.execPath, [cli, 'config', 'show'], 'verify', {
        environment,
        inheritEnvironment: false,
      });
    });

    const latestRelease = Effect.fn('Upgrades.latestRelease')(function* () {
      const response = yield* client.get(RELEASE_FEED).pipe(
        Effect.timeout('30 seconds'),
        Effect.mapError(() =>
          failure(
            'check',
            'GitHub release lookup failed; the current version remains active',
          ),
        ),
      );
      if (response.status === 404) {
        return undefined;
      }
      if (response.status !== 200) {
        return yield* Effect.fail(
          failure(
            'check',
            `GitHub release lookup returned HTTP ${String(response.status)}`,
          ),
        );
      }
      const release = yield* response.json.pipe(
        Effect.timeout('30 seconds'),
        Effect.flatMap(Schema.decodeUnknownEffect(githubRelease)),
        Effect.mapError(() =>
          failure('check', 'GitHub returned invalid release metadata'),
        ),
      );
      const version = yield* Schema.decodeUnknownEffect(StableVersion)(
        release.tag_name.replace(/^v/, ''),
      ).pipe(
        Effect.mapError(() =>
          failure(
            'check',
            'the latest release is not a stable semantic version',
          ),
        ),
      );
      if (
        release.draft ||
        release.prerelease ||
        release.tag_name !== `v${version}`
      ) {
        return yield* Effect.fail(
          failure(
            'check',
            'draft, prerelease, or unversioned builds cannot be installed',
          ),
        );
      }
      const metadata = yield* download(
        releaseAssetUrl(version, 'release.json'),
        64 * 1024,
      );
      const manifest = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(ReleaseManifest),
      )(new TextDecoder().decode(metadata)).pipe(
        Effect.mapError(() =>
          failure('manifest', 'the release checksum document is invalid'),
        ),
      );
      if (
        manifest.version !== version ||
        manifest.file !== `social-harness-${version}.tgz`
      ) {
        return yield* Effect.fail(
          failure(
            'manifest',
            'the release version and package filename do not match the GitHub tag',
          ),
        );
      }
      return manifest;
    });

    const stageRelease = Effect.fn('Upgrades.stageRelease')(function* (
      manifest: ReleaseManifest,
      stagingRoot: string,
    ) {
      const bytes = yield* download(
        releaseAssetUrl(manifest.version, manifest.file),
        MAX_ARCHIVE_BYTES,
      );
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== manifest.sha256) {
        return yield* Effect.fail(
          failure(
            'checksum',
            'the downloaded package does not match its release SHA256 checksum',
          ),
        );
      }
      const archive = path.join(stagingRoot, manifest.file);
      yield* fileSystem
        .writeFile(archive, bytes, { mode: 0o600 })
        .pipe(
          Effect.mapError(() =>
            failure('stage', 'the verified release archive could not be saved'),
          ),
        );
      const npmConfig = path.join(stagingRoot, 'npmrc');
      yield* storage.writeText(
        npmConfig,
        'ignore-scripts=true\nregistry=https://registry.npmjs.org/\n',
      );
      yield* runCommand(
        'npm',
        [
          'install',
          '--prefix',
          stagingRoot,
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--omit=dev',
          '--package-lock=false',
          '--userconfig',
          npmConfig,
          '--globalconfig',
          path.join(stagingRoot, 'empty-global-npmrc'),
          '--cache',
          path.join(stagingRoot, 'npm-cache'),
          '--registry=https://registry.npmjs.org/',
          archive,
        ],
        'install',
        {
          environment: { HOME: stagingRoot, PATH: executableSearchPath },
          inheritEnvironment: false,
          workingDirectory: stagingRoot,
        },
      );
      const packageRoot = path.join(
        stagingRoot,
        'node_modules',
        'social-harness',
      );
      yield* verifyPackage(packageRoot, manifest.version, stagingRoot);
      return packageRoot;
    });

    const repairRelease = Effect.fn('Upgrades.repairRelease')(function* (
      cliPath: string,
    ) {
      yield* runCommand(
        process.execPath,
        [cliPath, 'repair', '--adapters-only'],
        'repair',
        {
          environment: {
            SOCIAL_HARNESS_HOME: paths.home,
            AGENTMAIL_HOME: paths.agentmailHome,
          },
        },
      );
    });

    const normalize = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.mapError((error) =>
          error instanceof UpgradeError
            ? error
            : failure(
                operation,
                'the package files could not be read or staged',
              ),
        ),
      );
    return {
      runningVersion: () => normalize('package', runningVersion()),
      latest: latestRelease,
      stage: (manifest: ReleaseManifest, stagingRoot: string) =>
        normalize('stage', stageRelease(manifest, stagingRoot)),
      verify: (packageRoot: string, version: string, scratchRoot: string) =>
        normalize('verify', verifyPackage(packageRoot, version, scratchRoot)),
      repair: repairRelease,
    };
  }).pipe(Effect.withSpan('releasePackagesLayer')),
);

function releaseAssetUrl(version: string, filename: string): string {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${filename}`;
}

function failure(operation: string, reason: string): UpgradeError {
  return UpgradeError.make({ operation, reason });
}
