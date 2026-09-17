/**
 * @file Runs real native hosts inside marked homes with explicit auth reuse.
 */

import type * as PlatformError from 'effect/PlatformError';
import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as Schedule from 'effect/Schedule';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  EvaluationError,
  type Host,
  IsolationMarker,
  type ProcessResult,
  type Profile,
} from '../domain/index.js';

/** Prepares and checks scoped grants for the disposable native profiles. */
export {
  checkNativePermissions,
  prepareNativePermissions,
} from './permissions.js';

/** Executes a scoped child and retains partial output if it times out. */
export class HostProcesses extends Context.Service<
  HostProcesses,
  {
    readonly run: (
      profile: Profile,
      executable: string,
      args: readonly string[],
      timeoutSeconds: number,
    ) => Effect.Effect<ProcessResult, EvaluationError>;
  }
>()('evals/HostProcesses') {}

/**
 * Child environment excludes production profile, mail, and provider overrides.
 * @param profile Fixed directories for one host.
 * @param executablePath Candidate launcher and system executable search path.
 * @param claudeSecureStorage Native credential storage when reuse was requested.
 * @returns Complete child environment, without inherited overrides.
 */
export function isolatedEnvironment(
  profile: Profile,
  executablePath: string,
  claudeSecureStorage?: string,
): Record<string, string> {
  return {
    PATH: executablePath,
    HOME: profile.home,
    SOCIAL_HARNESS_USER_HOME: profile.home,
    SOCIAL_HARNESS_HOME: profile.harness,
    AGENTMAIL_HOME: profile.agentmail,
    CLAUDE_CONFIG_DIR: `${profile.home}/.claude`,
    CODEX_HOME: `${profile.home}/.codex`,
    SOCIAL_HARNESS_SCHEDULER_MODE: 'manual',
    TMPDIR: `${profile.home}/tmp`,
    LANG: 'en_US.UTF-8',
    NO_COLOR: '1',
    ...(profile.host === 'claude' &&
    profile.reuseNativeAuth &&
    claudeSecureStorage !== undefined
      ? { CLAUDE_SECURESTORAGE_CONFIG_DIR: claudeSecureStorage }
      : {}),
  };
}

/** Limits process lifetime and closes streams through Effect's child scope. */
export const hostProcessesLayer = Layer.effect(HostProcesses)(
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const inheritedPath = yield* Config.string('PATH');
    const path = yield* Path.Path;
    const originalHome = yield* Config.string('HOME');
    const claudeConfig = yield* Config.string('CLAUDE_CONFIG_DIR').pipe(
      Config.withDefault(path.join(originalHome, '.claude')),
    );
    const claudeSecureStorage = yield* Config.string(
      'CLAUDE_SECURESTORAGE_CONFIG_DIR',
    ).pipe(Config.withDefault(claudeConfig));
    return {
      run: Effect.fn('evals.runProcess')(function* (
        profile: Profile,
        executable: string,
        args: readonly string[],
        timeoutSeconds: number,
      ) {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const budget = { size: 0 };
        const run = Effect.scoped(
          Effect.gen(function* () {
            const handle = yield* spawner.spawn(
              ChildProcess.make(executable, [...args], {
                cwd: profile.workspace,
                env: isolatedEnvironment(
                  profile,
                  `${path.join(path.dirname(path.dirname(profile.home)), 'bin')}${path.sep === '\\' ? ';' : ':'}${inheritedPath}`,
                  claudeSecureStorage,
                ),
                extendEnv: false,
                stdin: 'ignore',
              }),
            );
            const result = yield* Effect.all(
              {
                exitCode: handle.exitCode,
                stdout: captureOutput(handle.stdout, stdout, budget),
                stderr: captureOutput(handle.stderr, stderr, budget),
              },
              { concurrency: 3 },
            );
            return { exitCode: Number(result.exitCode), timedOut: false };
          }),
        ).pipe(
          Effect.timeout(timeoutSeconds * 1_000),
          Effect.catchTag('TimeoutError', () =>
            Effect.succeed({ exitCode: -1, timedOut: true }),
          ),
          Effect.mapError(() =>
            EvaluationError.make({
              operation: 'process',
              reason:
                'Could not run the isolated native process or capture its output.',
            }),
          ),
        );
        const result = yield* run;
        return {
          ...result,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        };
      }),
    };
  }).pipe(Effect.withSpan('hostProcessesLayer')),
);

/**
 * Directory choices are fixed by host and never taken from a fixture.
 * @param root Marked evaluation root.
 * @param host Native host name.
 * @param reuseNativeAuth Whether the owner requested existing login reuse.
 * @returns The host's isolated profile paths.
 */
export function profileAt(
  root: string,
  host: Host,
  reuseNativeAuth = false,
): Profile {
  const home = `${root}/homes/${host}`;
  return {
    host,
    home,
    native: `${home}/.${host}`,
    workspace: `${home}/workspace`,
    harness: `${home}/.social-harness`,
    agentmail: `${home}/.agentmail`,
    reuseNativeAuth,
  };
}

/** Installs an owned PATH block after the isolated zsh startup customizations. */
export const prepareShellPath = Effect.fn('evals.prepareShellPath')(function* (
  profile: Profile,
  candidateBin: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const begin = '# Social Harness eval candidate PATH (owned)';
  const end = '# End Social Harness eval candidate PATH';
  const quotedBin = `'${candidateBin.replaceAll("'", "'\\''")}'`;
  const block = `${begin}\nexport PATH=${quotedBin}:"$PATH"\n${end}\n`;
  for (const filename of ['.zprofile', '.zshrc']) {
    const destination = `${profile.home}/${filename}`;
    const content = (yield* fs.exists(destination))
      ? yield* fs.readFileString(destination)
      : '';
    if (content.includes(begin) !== content.includes(end)) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'shell-path',
          reason:
            'An isolated shell profile contains an incomplete owned PATH block.',
        }),
      );
    }
    const preserved = content.replace(
      /^# Social Harness eval candidate PATH \(owned\)\n[\s\S]*?^# End Social Harness eval candidate PATH\n?/gm,
      '',
    );
    yield* fs.writeFileString(
      destination,
      `${preserved}${preserved.length === 0 || preserved.endsWith('\n') ? '' : '\n'}${block}`,
      { mode: 0o600 },
    );
  }
});

/** Rechecks the entire tree if native cache rotation removes an enumerated file. */
export const verifyContainment = Effect.fn('evals.verifyContainment')(
  function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const canonicalRoot = yield* fs.realPath(root);
    const entries = yield* fs.readDirectory(root, { recursive: true });
    for (const entry of entries) {
      const resolved = yield* fs.realPath(path.join(root, entry));
      if (
        resolved !== canonicalRoot &&
        !resolved.startsWith(`${canonicalRoot}${path.sep}`)
      ) {
        const relative = entry.split(path.sep).join('/');
        const nativeAlias =
          /^homes\/(?:claude|codex)\/\.codex\/tmp\/arg0\/codex-arg0[a-zA-Z0-9-]+\/(?:apply_patch|applypatch|codex-execve-wrapper)$/.test(
            relative,
          );
        if (
          nativeAlias &&
          path.basename(resolved) === 'codex' &&
          path.basename(path.dirname(resolved)) === 'bin'
        ) {
          const target = yield* fs.stat(resolved);
          if (target.type === 'File' && (target.mode & 0o111) !== 0) {
            continue;
          }
        }
        return yield* Effect.fail(
          EvaluationError.make({
            operation: 'isolation',
            reason: `An eval file or profile symlink escapes its dedicated root: ${entry}`,
          }),
        );
      }
    }
  },
  Effect.retry({
    times: 2,
    schedule: Schedule.spaced('25 millis'),
    while: (error) =>
      error._tag === 'PlatformError' && error.reason._tag === 'NotFound',
  }),
);

/** Seeds only an absent private auth cache; native configuration stays isolated. */
export const seedCodexAuthentication = Effect.fn(
  'evals.seedCodexAuthentication',
)(
  function* (root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* Schema.decodeUnknownEffect(Schema.fromJsonString(IsolationMarker))(
      yield* fs.readFileString(path.join(root, '.social-harness-eval.json')),
    );
    yield* verifyContainment(root);
    const destination = path.join(profileAt(root, 'codex').native, 'auth.json');
    if (yield* fs.exists(destination)) {
      return;
    }
    const originalHome = yield* Config.string('HOME');
    const nativeHome = yield* Config.string('CODEX_HOME').pipe(
      Config.withDefault(path.join(originalHome, '.codex')),
    );
    const source = path.join(nativeHome, 'auth.json');
    const info = yield* fs.stat(source);
    if (info.type !== 'File' || (info.mode & 0o077) !== 0) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'native-auth',
          reason:
            'The existing Codex auth cache must be a private regular file.',
        }),
      );
    }
    yield* Effect.gen(function* () {
      const temporary = yield* fs.makeTempFileScoped({
        directory: path.dirname(destination),
        prefix: '.auth-snapshot-',
      });
      yield* fs.copyFile(source, temporary);
      yield* fs.chmod(temporary, 0o600);
      // Validate the JSON boundary without interpreting or reporting tokens.
      // The native CLI validates the provider-specific credential semantics.
      yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
      )(yield* fs.readFileString(temporary));
      yield* fs
        .link(temporary, destination)
        .pipe(
          Effect.catch((error) =>
            error.reason._tag === 'AlreadyExists'
              ? Effect.void
              : Effect.fail(error),
          ),
        );
    }).pipe(Effect.scoped, Effect.withSpan('seedCodexAuthentication'));
  },
  Effect.mapError(() =>
    EvaluationError.make({
      operation: 'native-auth',
      reason:
        'Could not seed the private Codex auth cache. Check the existing login and private file permissions; existing eval credentials are never overwritten.',
    }),
  ),
);

/** Creates only marked disposable directories, refusing an unrelated target. */
export const initializeRoot = Effect.fn('evals.initializeRoot')(function* (
  requested: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realHome = yield* Config.string('HOME');
  const root = path.resolve(requested);
  if (
    !path.isAbsolute(requested) ||
    !/^social-harness-eval-[a-z0-9][a-z0-9-]*$/.test(path.basename(root)) ||
    root === path.resolve(realHome)
  ) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'isolation',
        reason:
          'Use an absolute dedicated directory named social-harness-eval-<safe-id>.',
      }),
    );
  }
  const marker = path.join(root, '.social-harness-eval.json');
  if (yield* fs.exists(root)) {
    if (!(yield* fs.exists(marker))) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'isolation',
          reason:
            'Existing eval root has no ownership marker; choose a new directory.',
        }),
      );
    }
    yield* Schema.decodeUnknownEffect(Schema.fromJsonString(IsolationMarker))(
      yield* fs.readFileString(marker),
    );
    yield* verifyContainment(root);
  } else {
    yield* fs.makeDirectory(root, { recursive: true, mode: 0o700 });
    yield* fs.writeFileString(
      marker,
      JSON.stringify(
        IsolationMarker.make({
          schemaVersion: 1,
          purpose: 'social-harness-real-host-evals',
        }),
      ),
      { mode: 0o600 },
    );
  }
  for (const host of ['claude', 'codex'] satisfies Host[]) {
    const profile = profileAt(root, host);
    for (const directory of [
      profile.workspace,
      profile.native,
      profile.harness,
      profile.agentmail,
      `${profile.home}/.claude`,
      `${profile.home}/.codex`,
      `${profile.home}/tmp`,
    ]) {
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    }
  }
  yield* fs.makeDirectory(path.join(root, 'evidence'), {
    recursive: true,
    mode: 0o700,
  });
  yield* fs.makeDirectory(path.join(root, 'bin'), {
    recursive: true,
    mode: 0o700,
  });
  return root;
});

/**
 * Builds native continuation arguments using the captured ID only.
 * @param profile Host and isolated directories.
 * @param prompt Owner-authorized scenario prompt.
 * @param sessionId Exact native ID when continuing a previous turn.
 * @returns Arguments without permission or hook-trust bypasses.
 */
export function hostArguments(
  profile: Profile,
  prompt: string,
  sessionId?: string,
): readonly string[] {
  if (profile.host === 'claude') {
    return [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-hook-events',
      '--permission-prompts',
      'none',
      '--add-dir',
      profile.home,
      ...(sessionId === undefined ? [] : ['--resume', sessionId]),
      '--',
      prompt,
    ];
  }
  const writableRoots = `sandbox_workspace_write.writable_roots=${JSON.stringify(
    [profile.home],
  )}`;
  return sessionId === undefined
    ? [
        'exec',
        '--json',
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true',
        '--add-dir',
        profile.home,
        '--skip-git-repo-check',
        prompt,
      ]
    : [
        'exec',
        'resume',
        '--json',
        '-c',
        'sandbox_workspace_write.network_access=true',
        '-c',
        writableRoots,
        '--skip-git-repo-check',
        sessionId,
        prompt,
      ];
}

function captureOutput(
  stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  target: string[],
  budget: { size: number },
) {
  return stream.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.gen(function* () {
        budget.size += chunk.length;
        if (budget.size > 5_000_000) {
          return yield* Effect.fail(
            EvaluationError.make({
              operation: 'capture',
              reason: 'Host output exceeded the five megabyte evidence limit.',
            }),
          );
        }
        target.push(chunk);
      }),
    ),
  );
}
