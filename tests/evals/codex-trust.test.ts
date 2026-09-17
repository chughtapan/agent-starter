/**
 * @file Exercises native trust through the public operation and stdio RPC boundary.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Queue from 'effect/Queue';
import * as Schema from 'effect/Schema';
import * as Sink from 'effect/Sink';
import * as Stream from 'effect/Stream';
import { FastCheck } from 'effect/testing';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import { trustOwnedCodexHooks } from '../../evals/codex-trust/index.js';
import { initializeRoot, profileAt } from '../../evals/hosts/index.js';

const REQUEST = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optionalKey(Schema.Number),
    method: Schema.String,
    params: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  }),
);
const WRITES = Schema.Struct({
  filePath: Schema.String,
  edits: Schema.Array(
    Schema.Struct({
      keyPath: Schema.String,
      value: Schema.String,
      mergeStrategy: Schema.Literal('upsert'),
    }),
  ),
});
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop'];
const NATIVE_EVENTS = [
  'sessionStart',
  'userPromptSubmit',
  'postToolUse',
  'stop',
];

const fixture = Effect.fn('test.codexTrustFixture')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const directory = yield* fs.makeTempDirectoryScoped({
    prefix: 'codex-trust-test-',
  });
  const root = yield* initializeRoot(`${directory}/social-harness-eval-unit`);
  const profile = profileAt(root, 'codex');
  const source = `${profile.native}/hooks.json`;
  yield* fs.makeDirectory(`${profile.harness}/state`, { recursive: true });
  yield* fs.writeFileString(
    `${profile.harness}/state/ownership.json`,
    JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          kind: 'configEntry',
          adapter: 'codex',
          path: source,
          identifier: 'social-harness host-hook',
        },
      ],
    }),
  );
  yield* fs.writeFileString(
    source,
    JSON.stringify({
      hooks: Object.fromEntries(
        EVENTS.map((event) => [
          event,
          [
            {
              hooks: [
                {
                  type: 'command',
                  command: `social-harness host-hook --event ${event} --host codex`,
                  timeout: 10,
                },
              ],
            },
          ],
        ]),
      ),
    }),
  );
  const hooks = EVENTS.map((event, index) => ({
    key: `${source}:${event}:0:0`,
    currentHash: `native-hash-${String(index)}`,
    eventName: NATIVE_EVENTS[index] ?? '',
    handlerType: 'command',
    command: `social-harness host-hook --event ${event} --host codex`,
    source: 'user',
    sourcePath: source,
    matcher: null,
    timeoutSec: 10,
    enabled: true,
    isManaged: false,
    trustStatus: 'untrusted',
  }));
  const firstHook = hooks[0];
  if (firstHook === undefined) {
    return yield* Effect.die(
      'The native hook fixture needs at least one event.',
    );
  }
  hooks.push({
    ...firstHook,
    key: `${source}:other:0:0`,
    eventName: 'sessionStart',
    command: 'unrelated-tool',
  });
  const persisted = new Map<string, string>();
  const methods: string[] = [];
  const writes: string[] = [];
  const state = { sessions: 0, rejectWrite: false, changeHashOnReopen: false };
  const respond = (output: Queue.Enqueue<Uint8Array>, bytes: Uint8Array) =>
    Effect.gen(function* () {
      const request = yield* Schema.decodeUnknownEffect(REQUEST)(
        new TextDecoder().decode(bytes),
      );
      methods.push(request.method);
      if (request.id === undefined) {
        return;
      }
      let result: object;
      if (request.method === 'initialize') {
        result = {
          codexHome: profile.native,
          userAgent: 'codex-fixture/0.154',
        };
      } else if (request.method === 'hooks/list') {
        result = {
          data: [
            {
              cwd: profile.workspace,
              errors: [],
              warnings: [],
              hooks: hooks.map((hook, index) => ({
                ...hook,
                currentHash:
                  state.changeHashOnReopen && state.sessions > 1 && index === 0
                    ? 'changed-native-hash'
                    : hook.currentHash,
                trustStatus:
                  persisted.get(
                    `hooks.state.${JSON.stringify(hook.key)}.trusted_hash`,
                  ) === hook.currentHash
                    ? 'trusted'
                    : hook.trustStatus,
              })),
            },
          ],
        };
      } else {
        assert.strictEqual(request.method, 'config/batchWrite');
        if (state.rejectWrite) {
          yield* Queue.offer(
            output,
            new TextEncoder().encode(
              `${JSON.stringify({ id: request.id, error: { code: 400, message: 'Authorization: fixture-secret' } })}\n`,
            ),
          );
          return;
        }
        const edits = yield* Schema.decodeUnknownEffect(WRITES)(request.params);
        assert.strictEqual(edits.filePath, `${profile.native}/config.toml`);
        for (const edit of edits.edits) {
          writes.push(edit.keyPath);
          persisted.set(edit.keyPath, edit.value);
        }
        result = {
          filePath: `${profile.native}/config.toml`,
          status: 'ok',
          version: '1',
        };
      }
      yield* Queue.offer(
        output,
        new TextEncoder().encode(
          `${JSON.stringify({ id: request.id, result })}\n`,
        ),
      );
    });
  const spawner = ChildProcessSpawner.make(() =>
    Effect.gen(function* () {
      state.sessions++;
      const output = yield* Queue.unbounded<Uint8Array>();
      const handle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(100),
        exitCode: Effect.never,
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.forEach((bytes: Uint8Array) =>
          respond(output, bytes).pipe(Effect.orDie),
        ),
      });
      return handle;
    }),
  );
  return { profile, hooks, methods, writes, state, persisted, spawner };
});

describe('owned native hook trust', () => {
  it('persists exact native hashes, preserves disabled and unrelated hooks, and is idempotent', () =>
    Effect.gen(function* () {
      const current = yield* fixture();
      const stop = current.hooks.find((hook) => hook.eventName === 'stop');
      if (stop !== undefined) {
        stop.enabled = false;
      }
      const first = yield* trustOwnedCodexHooks(current.profile).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          current.spawner,
        ),
      );
      assert.strictEqual(first.changedKeys.length, 3);
      assert.strictEqual(current.state.sessions, 2);
      assert.strictEqual(current.writes.length, 3);
      assert.isTrue(
        current.writes.every((key) => key.endsWith('.trusted_hash')),
      );
      assert.isFalse(
        current.writes.some(
          (key) => key.includes(':Stop:') || key.includes(':other:'),
        ),
      );
      const second = yield* trustOwnedCodexHooks(current.profile).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          current.spawner,
        ),
      );
      assert.deepStrictEqual(second.changedKeys, []);
      assert.strictEqual(current.writes.length, 3);
      assert.strictEqual(current.state.sessions, 4);
    }).pipe(
      Effect.scoped,
      Effect.provide(NodeServices.layer),
      Effect.runPromise,
    ));

  it.effect.prop(
    'arbitrary replacement commands cannot acquire owned trust',
    [
      FastCheck.string({ maxLength: 120 }).filter(
        (value) =>
          value !==
          'social-harness host-hook --event SessionStart --host codex',
      ),
    ],
    ([command]) =>
      Effect.gen(function* () {
        const current = yield* fixture();
        const first = current.hooks[0];
        if (first !== undefined) {
          first.command = command;
        }
        const result = yield* trustOwnedCodexHooks(current.profile).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            current.spawner,
          ),
          Effect.result,
        );
        assert.strictEqual(result._tag, 'Failure');
        assert.deepStrictEqual(current.writes, []);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    { fastCheck: { numRuns: 15 } },
  );

  it.effect('native write errors expose no raw server diagnostics', () =>
    Effect.gen(function* () {
      const current = yield* fixture();
      current.state.rejectWrite = true;
      const result = yield* trustOwnedCodexHooks(current.profile).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          current.spawner,
        ),
        Effect.result,
      );
      assert.strictEqual(result._tag, 'Failure');
      assert.notInclude(JSON.stringify(result), 'fixture-secret');
      assert.deepStrictEqual(current.writes, []);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'a changed native hash cannot pass verification in the fresh process',
    () =>
      Effect.gen(function* () {
        const current = yield* fixture();
        current.state.changeHashOnReopen = true;
        const result = yield* trustOwnedCodexHooks(current.profile).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            current.spawner,
          ),
          Effect.result,
        );
        assert.strictEqual(result._tag, 'Failure');
        assert.strictEqual(current.state.sessions, 2);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
