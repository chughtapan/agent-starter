/**
 * @file Persists native trust only for exact, owned isolated Codex hooks.
 */

import * as Clock from 'effect/Clock';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';
import * as Queue from 'effect/Queue';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  EvaluationError,
  IsolationMarker,
  type Profile,
} from '../domain/index.js';
import {
  isolatedEnvironment,
  profileAt,
  verifyContainment,
} from '../hosts/index.js';
import {
  Envelope,
  HooksResponse,
  InitializeResponse,
  type NativeHook,
  type TrustEdit,
  WriteResponse,
} from './schema.js';

const OWNERSHIP = Schema.fromJsonString(
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    entries: Schema.Array(
      Schema.Struct({
        kind: Schema.String,
        adapter: Schema.String,
        path: Schema.String,
        identifier: Schema.optionalKey(Schema.String),
      }),
    ),
  }),
);
const HOOK_FILE = Schema.fromJsonString(
  Schema.Struct({
    hooks: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)),
  }),
);
const GROUP = Schema.Struct({
  matcher: Schema.optionalKey(Schema.String),
  hooks: Schema.Array(Schema.Unknown),
});
const HANDLER = Schema.Struct({
  type: Schema.String,
  command: Schema.optionalKey(Schema.String),
  timeout: Schema.optionalKey(Schema.Number),
  async: Schema.optionalKey(Schema.Boolean),
});
const EVENTS = [
  { configured: 'SessionStart', native: 'sessionStart' },
  { configured: 'UserPromptSubmit', native: 'userPromptSubmit' },
  { configured: 'PostToolUse', native: 'postToolUse' },
  { configured: 'Stop', native: 'stop' },
];

/** Records only owned hook metadata, never native profile contents. */
interface CodexTrustEvidence {
  readonly schemaVersion: 1;
  readonly host: 'codex';
  readonly sourcePath: string;
  readonly nativeVersion: string;
  readonly verifiedAt: string;
  readonly changedKeys: readonly string[];
  readonly hooks: ReadonlyArray<{
    readonly key: string;
    readonly event: string;
    readonly hash: string;
    readonly enabled: boolean;
    readonly trustStatus: string;
  }>;
}

/** Shares one output budget across decoded responses and discarded diagnostics. */
const captureResponses = Effect.fn('evals.captureNativeResponses')(function* (
  handle: ChildProcessSpawner.ChildProcessHandle,
) {
  const responses = yield* Queue.bounded<typeof Envelope.Type, EvaluationError>(
    32,
  );
  let bytes = 0;
  const count = (chunk: Uint8Array) =>
    Effect.gen(function* () {
      bytes += chunk.byteLength;
      if (bytes > 1_000_000) {
        return yield* Effect.fail(
          failure('Native hook API output exceeded its one megabyte limit.'),
        );
      }
    });
  yield* handle.stdout.pipe(
    Stream.tap(count),
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim().length > 0),
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Envelope)(line)),
    Stream.runForEach((response) => Queue.offer(responses, response)),
    Effect.andThen(
      Queue.fail(
        responses,
        failure('Native hook API closed before completing its requests.'),
      ),
    ),
    Effect.catch(() =>
      Queue.fail(
        responses,
        failure('Native hook API returned invalid or excessive output.'),
      ),
    ),
    Effect.forkScoped,
  );
  yield* handle.stderr.pipe(
    Stream.tap(count),
    Stream.runDrain,
    Effect.catch(() =>
      Queue.fail(
        responses,
        failure(
          'Native hook API diagnostic output could not be captured safely.',
        ),
      ),
    ),
    Effect.forkScoped,
  );
  return responses;
});

/** Opens one scoped native connection; the caller supplies its lifetime. */
const openCodexServer = Effect.fn('evals.openCodexServer')(function* (
  profile: Profile,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const inheritedPath = yield* Config.string('PATH');
  const root = path.dirname(path.dirname(profile.home));
  const handle = yield* spawner.spawn(
    ChildProcess.make('codex', ['app-server'], {
      cwd: profile.workspace,
      env: isolatedEnvironment(profile, `${root}/bin:${inheritedPath}`),
      extendEnv: false,
      stdin: { stream: 'pipe', endOnDone: false },
    }),
  );
  const responses = yield* captureResponses(handle);
  let nextId = 0;
  const send = (value: object) =>
    Stream.make(new TextEncoder().encode(`${JSON.stringify(value)}\n`)).pipe(
      Stream.run(handle.stdin),
    );
  const request = Effect.fn('evals.nativeHookRequest')(function* (
    method: string,
    params: object,
  ) {
    const id = ++nextId;
    yield* send({ id, method, params });
    while (true) {
      const response = yield* Queue.take(responses);
      if (response.id === undefined) {
        continue;
      }
      if (response.id !== id || response.error !== undefined) {
        return yield* Effect.fail(
          failure(
            `Native ${method} request was rejected or returned an unexpected response.`,
          ),
        );
      }
      return response.result;
    }
  }, Effect.timeout('10 seconds'));
  const initialized = yield* request('initialize', {
    clientInfo: { name: 'social_harness_evals', version: '1.0.0' },
    capabilities: { experimentalApi: true },
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(InitializeResponse)));
  if (
    (yield* fs.realPath(initialized.codexHome)) !==
    (yield* fs.realPath(profile.native))
  ) {
    return yield* Effect.fail(
      failure('Native hook API selected a different profile.'),
    );
  }
  yield* send({ method: 'initialized' });
  return {
    userAgent: initialized.userAgent,
    list: () =>
      request('hooks/list', { cwds: [profile.workspace] }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(HooksResponse)),
      ),
    write: (edits: ReadonlyArray<typeof TrustEdit.Type>) =>
      request('config/batchWrite', {
        filePath: `${profile.native}/config.toml`,
        edits,
        reloadUserConfig: true,
      }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(WriteResponse))),
  };
}, Effect.withSpan('openCodexServer'));

/** Uses two native processes so verification observes the persisted trust store. */
export const trustOwnedCodexHooks = Effect.fn('evals.trustOwnedCodexHooks')(
  function* (profile: Profile) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.dirname(path.dirname(profile.home));
    const expected = profileAt(root, 'codex', profile.reuseNativeAuth);
    if (
      profile.host !== 'codex' ||
      profile.home !== expected.home ||
      profile.native !== expected.native ||
      profile.harness !== expected.harness ||
      profile.workspace !== expected.workspace ||
      !/^social-harness-eval-[a-z0-9][a-z0-9-]*$/.test(path.basename(root))
    ) {
      return yield* Effect.fail(
        failure(
          'Native trust writes require an exact isolated Codex eval profile.',
        ),
      );
    }
    yield* Schema.decodeUnknownEffect(Schema.fromJsonString(IsolationMarker))(
      yield* fs.readFileString(`${root}/.social-harness-eval.json`),
    );
    yield* verifyContainment(root);
    const canonicalRoot = yield* fs.realPath(root);
    const sourcePath = `${profile.native}/hooks.json`;
    for (const filename of [
      profile.home,
      profile.native,
      profile.harness,
      sourcePath,
    ]) {
      if (
        (yield* fs.realPath(filename)) !==
        path.join(canonicalRoot, path.relative(root, filename))
      ) {
        return yield* Effect.fail(
          failure('Native trust cannot follow profile or hook aliases.'),
        );
      }
    }
    const configPath = `${profile.native}/config.toml`;
    if (
      (yield* fs.exists(configPath)) &&
      (yield* fs.realPath(configPath)) !==
        path.join(canonicalRoot, path.relative(root, configPath))
    ) {
      return yield* Effect.fail(
        failure('Native trust cannot write through a config alias.'),
      );
    }
    const manifestPath = `${profile.harness}/state/ownership.json`;
    const manifestText = yield* fs.readFileString(manifestPath);
    const manifest = yield* Schema.decodeUnknownEffect(OWNERSHIP)(manifestText);
    if (
      !manifest.entries.some(
        (entry) =>
          entry.kind === 'configEntry' &&
          entry.adapter === 'codex' &&
          entry.path === sourcePath &&
          entry.identifier === 'social-harness host-hook',
      )
    ) {
      return yield* Effect.fail(
        failure(
          'The Codex hook file is not recorded as an owned Social Harness config entry.',
        ),
      );
    }
    const hookText = yield* fs.readFileString(sourcePath);
    const configured = yield* Schema.decodeUnknownEffect(HOOK_FILE)(hookText);
    for (const event of EVENTS) {
      const candidates = (configured.hooks[event.configured] ?? []).flatMap(
        (value) => {
          if (!Schema.is(GROUP)(value) || value.matcher !== undefined) {
            return [];
          }
          return value.hooks.filter(
            (handler) =>
              Schema.is(HANDLER)(handler) &&
              handler.type === 'command' &&
              handler.command === command(event.configured) &&
              handler.timeout === 10 &&
              handler.async !== true,
          );
        },
      );
      if (candidates.length !== 1) {
        return yield* Effect.fail(
          failure(
            'The owned hook file does not match the exact candidate commands and settings.',
          ),
        );
      }
    }

    const before = yield* Effect.gen(function* () {
      const server = yield* openCodexServer(profile);
      const hooks = hooksAt(yield* server.list(), profile.workspace);
      const owned = selectOwned(hooks, sourcePath);
      if (
        owned.length !== EVENTS.length ||
        new Set(owned.map((hook) => hook.key)).size !== EVENTS.length ||
        EVENTS.some(
          (event) =>
            owned.filter((hook) => hook.eventName === event.native).length !==
            1,
        )
      ) {
        return yield* Effect.fail(
          failure(
            'Native hook metadata does not match every owned candidate hook.',
          ),
        );
      }
      if (
        (yield* fs.readFileString(sourcePath)) !== hookText ||
        (yield* fs.readFileString(manifestPath)) !== manifestText
      ) {
        return yield* Effect.fail(
          failure('Owned hook files changed during trust validation.'),
        );
      }
      const edits = owned
        .filter((hook) => hook.enabled && hook.trustStatus !== 'trusted')
        .map((hook) => ({
          keyPath: `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`,
          value: hook.currentHash,
          mergeStrategy: 'upsert' as const,
        }));
      if (edits.length > 0) {
        const written = yield* server.write(edits);
        if (
          written.status !== 'ok' ||
          path.resolve(written.filePath) !== path.resolve(configPath)
        ) {
          return yield* Effect.fail(
            failure(
              'Native trust write was overridden or targeted another config file.',
            ),
          );
        }
      }
      return {
        hooks,
        owned,
        changedKeys: owned
          .filter((hook) => hook.enabled && hook.trustStatus !== 'trusted')
          .map((hook) => hook.key),
        nativeVersion: server.userAgent,
      };
    }).pipe(Effect.scoped);
    const after = yield* Effect.gen(function* () {
      const server = yield* openCodexServer(profile);
      return hooksAt(yield* server.list(), profile.workspace);
    }).pipe(Effect.scoped);
    for (const prior of before.hooks) {
      const current = after.find((hook) => hook.key === prior.key);
      const selected = before.owned.some(
        (hook) => hook.key === prior.key && hook.enabled,
      );
      if (
        current === undefined ||
        current.currentHash !== prior.currentHash ||
        current.enabled !== prior.enabled ||
        current.trustStatus !== (selected ? 'trusted' : prior.trustStatus)
      ) {
        return yield* Effect.fail(
          failure(
            'Native trust verification failed or unrelated hook state changed.',
          ),
        );
      }
    }
    return {
      schemaVersion: 1,
      host: 'codex',
      sourcePath,
      nativeVersion: before.nativeVersion,
      changedKeys: before.changedKeys,
      verifiedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      hooks: selectOwned(after, sourcePath).map((hook) => ({
        key: hook.key,
        event: hook.eventName,
        hash: hook.currentHash,
        enabled: hook.enabled,
        trustStatus: hook.trustStatus,
      })),
    } satisfies CodexTrustEvidence;
  },
  Effect.timeout('35 seconds'),
  Effect.mapError((error) =>
    failure(
      error._tag === 'EvaluationError'
        ? error.reason
        : 'Native trust setup could not complete through the validated local API.',
    ),
  ),
  Effect.withSpan('trustOwnedCodexHooks'),
);

function command(event: string): string {
  return `social-harness host-hook --event ${event} --host codex`;
}

function hooksAt(
  response: typeof HooksResponse.Type,
  workspace: string,
): ReadonlyArray<typeof NativeHook.Type> {
  const entries = response.data.filter(
    (entry) => entry.cwd === workspace && entry.errors.length === 0,
  );
  return entries.length === 1 ? (entries[0]?.hooks ?? []) : [];
}

function selectOwned(
  hooks: ReadonlyArray<typeof NativeHook.Type>,
  sourcePath: string,
): ReadonlyArray<typeof NativeHook.Type> {
  return hooks.filter(
    (hook) =>
      hook.source === 'user' &&
      hook.sourcePath === sourcePath &&
      hook.key.startsWith(`${sourcePath}:`) &&
      !hook.isManaged &&
      hook.handlerType === 'command' &&
      hook.timeoutSec === 10 &&
      hook.matcher == null &&
      hook.async !== true &&
      EVENTS.some(
        (event) =>
          hook.eventName === event.native &&
          hook.command === command(event.configured),
      ),
  );
}

function failure(reason: string): EvaluationError {
  return EvaluationError.make({ operation: 'native-hook-trust', reason });
}
