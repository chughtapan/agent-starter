/**
 * @file Checks native host event output through the public CLI command.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';
import * as Stdio from 'effect/Stdio';
import * as Stream from 'effect/Stream';
import { FastCheck } from 'effect/testing';
import * as TestConsole from 'effect/testing/TestConsole';
import * as Command from 'effect/unstable/cli/Command';

import type { HostHookEvent } from '../../src/domain/runtime.js';
import {
  hostHookCommand,
  presentedCommand,
} from '../../src/application/commands/index.js';
import { Board, Receipts } from '../../src/collaboration/presentation/index.js';
import { HostObservation } from '../../src/domain/identity.js';
import { DocumentTemplates } from '../../src/platform/documents/index.js';
import { pathsLayer, Storage } from '../../src/platform/persistence/index.js';

const TRUSTED_REMINDER = 'Retrieve updates and show them in this conversation.';
const STOP_OUTPUT = Schema.fromJsonString(
  Schema.Struct({
    decision: Schema.Literal('block'),
    reason: Schema.String,
  }),
);
const CONTEXT_OUTPUT = Schema.fromJsonString(
  Schema.Struct({
    hookSpecificOutput: Schema.Struct({
      hookEventName: Schema.String,
      additionalContext: Schema.String,
    }),
  }),
);

const runHook = Effect.fn('test.runHook')(function* (
  event: typeof HostHookEvent.Type,
  input: object,
  options?: {
    readonly shouldPresent?: boolean;
    readonly host?: 'claude' | 'codex';
  },
) {
  let boardChecks = 0;
  const confirmations: Array<{ host: string; text: string }> = [];
  const files = new Map<string, unknown>();
  const dependencies = Layer.mergeAll(
    pathsLayer.pipe(
      Layer.provide(NodeServices.layer),
      Layer.provide(
        ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: '/fixture' })),
      ),
    ),
    Layer.mock(Storage)({
      exists: () => Effect.succeed(true),
      writeJson: (path, value) =>
        Effect.sync(() => {
          files.set(path, value);
        }),
    }),
    Layer.mock(DocumentTemplates)({
      hostHook: () => Effect.succeed(TRUSTED_REMINDER),
    }),
    Layer.mock(Receipts)({
      confirm: (host, text) =>
        Effect.sync(() => {
          confirmations.push({ host, text });
          return [];
        }),
    }),
    Layer.mock(Board)({
      check: () =>
        Effect.sync(() => {
          boardChecks++;
          return {
            updates: [],
            rendered: 'Untrusted message content must stay out of hook output',
            shouldPresent: options?.shouldPresent ?? true,
            source: 'cache',
            unpresentedMessageIds: [],
          };
        }),
    }),
  );
  const lines = yield* Effect.gen(function* () {
    yield* Command.runWith(hostHookCommand, { version: '0.0.0' })([
      '--event',
      event,
      ...(options?.host === undefined ? [] : ['--host', options.host]),
    ]);
    return yield* TestConsole.logLines;
  }).pipe(
    Effect.provide(dependencies),
    Effect.provide(Layer.fresh(TestConsole.layer)),
    Effect.provide(
      Stdio.layerTest({
        stdin: Stream.make(new TextEncoder().encode(JSON.stringify(input))),
      }),
    ),
    Effect.provide(NodeServices.layer),
  );
  return { lines, boardChecks, files, confirmations };
});

describe('native host hooks', () => {
  it('Stop asks the host to continue with only the trusted reminder', () =>
    Effect.gen(function* () {
      const result = yield* runHook('Stop', { hook_event_name: 'Stop' });
      assert.strictEqual(result.boardChecks, 1);
      assert.lengthOf(result.lines, 1);
      const output = yield* Schema.decodeUnknownEffect(STOP_OUTPUT)(
        result.lines[0],
      );
      assert.strictEqual(output.decision, 'block');
      assert.strictEqual(output.reason, TRUSTED_REMINDER);
    }).pipe(Effect.runPromise));

  it.effect.prop(
    'arbitrary tool data cannot become trusted Stop instructions',
    [FastCheck.jsonValue()],
    ([untrusted]) =>
      Effect.gen(function* () {
        const result = yield* runHook('Stop', {
          hook_event_name: 'Stop',
          tool_input: { content: untrusted },
        });
        assert.deepStrictEqual(result.lines, [
          JSON.stringify({ decision: 'block', reason: TRUSTED_REMINDER }),
        ]);
      }),
    { fastCheck: { numRuns: 25 } },
  );

  it.effect('a continued Stop cannot request another continuation', () =>
    Effect.gen(function* () {
      const result = yield* runHook('Stop', {
        hook_event_name: 'Stop',
        stop_hook_active: true,
      });
      assert.strictEqual(result.boardChecks, 0);
      assert.deepStrictEqual(result.lines, []);
    }),
  );

  it.effect(
    'a continued Stop confirms actual output before its recursion guard',
    () =>
      Effect.gen(function* () {
        const result = yield* runHook(
          'Stop',
          {
            hook_event_name: 'Stop',
            stop_hook_active: true,
            last_assistant_message: 'UPDATES\nALL CLEAR',
          },
          { host: 'claude' },
        );
        assert.deepStrictEqual(result.confirmations, [
          { host: 'claude', text: 'UPDATES\nALL CLEAR' },
        ]);
        assert.strictEqual(result.boardChecks, 0);
        assert.deepStrictEqual(result.lines, []);
      }),
  );

  it.effect(
    'non-Stop and unidentified native events cannot confirm presentation',
    () =>
      Effect.gen(function* () {
        for (const [event, inputEvent, host] of [
          ['PostToolUse', 'PostToolUse', 'codex'],
          ['Stop', 'UserPromptSubmit', 'claude'],
          ['Stop', 'Stop', undefined],
        ] as const) {
          const result = yield* runHook(
            event,
            {
              hook_event_name: inputEvent,
              last_assistant_message: 'UPDATES\nALL CLEAR',
            },
            host === undefined ? {} : { host },
          );
          assert.deepStrictEqual(result.confirmations, []);
        }
      }),
  );

  it.effect('other supported events retain their context output contract', () =>
    Effect.gen(function* () {
      const events: ReadonlyArray<typeof HostHookEvent.Type> = [
        'SessionStart',
        'UserPromptSubmit',
        'PostToolUse',
      ];
      for (const event of events) {
        const result = yield* runHook(event, { hook_event_name: event });
        assert.strictEqual(result.boardChecks, 1);
        assert.lengthOf(result.lines, 1);
        const output = yield* Schema.decodeUnknownEffect(CONTEXT_OUTPUT)(
          result.lines[0],
        );
        assert.strictEqual(output.hookSpecificOutput.hookEventName, event);
        assert.strictEqual(
          output.hookSpecificOutput.additionalContext,
          TRUSTED_REMINDER,
        );
      }
    }),
  );

  it.effect(
    'quiet boards and the harness own tool calls produce no reminder',
    () =>
      Effect.gen(function* () {
        const quiet = yield* runHook(
          'Stop',
          { hook_event_name: 'Stop' },
          { shouldPresent: false },
        );
        const ownTool = yield* runHook('PostToolUse', {
          hook_event_name: 'PostToolUse',
          tool_input: { command: 'social-harness presented --receipt example' },
        });
        assert.strictEqual(quiet.boardChecks, 1);
        assert.deepStrictEqual(quiet.lines, []);
        assert.strictEqual(ownTool.boardChecks, 0);
        assert.deepStrictEqual(ownTool.lines, []);
      }),
  );

  it.effect(
    'native observations identify only the host that invoked the hook',
    () =>
      Effect.gen(function* () {
        const result = yield* runHook(
          'SessionStart',
          {
            hook_event_name: 'SessionStart',
          },
          { host: 'codex' },
        );
        const observation = yield* Schema.decodeUnknownEffect(HostObservation)(
          result.files.get(
            '/fixture/.social-harness/state/host-observation-codex.json',
          ),
        );
        assert.strictEqual(observation.host, 'codex');
        assert.strictEqual(observation.event, 'SessionStart');
        assert.isFalse(
          result.files.has(
            '/fixture/.social-harness/state/host-observation-claude.json',
          ),
        );
        const output = yield* Schema.decodeUnknownEffect(CONTEXT_OUTPUT)(
          result.lines[0],
        );
        assert.include(
          output.hookSpecificOutput.additionalContext,
          'present --host codex',
        );
      }),
  );

  it.effect('a mismatched event cannot record native evidence', () =>
    Effect.gen(function* () {
      const result = yield* runHook(
        'SessionStart',
        {
          hook_event_name: 'Stop',
        },
        { host: 'claude' },
      );
      assert.strictEqual(result.files.size, 0);
    }),
  );

  it.effect(
    'presentation acknowledgements carry the explicitly selected host',
    () => {
      const calls: Array<{
        receipt: string;
        messageIds: readonly string[];
        host: string;
      }> = [];
      return Effect.gen(function* () {
        yield* Command.runWith(presentedCommand, { version: '0.0.0' })([
          '--receipt',
          'snapshot',
          '--message-id',
          'reply',
          '--host',
          'openClaw',
        ]);
        assert.deepStrictEqual(calls, [
          { receipt: 'snapshot', messageIds: ['reply'], host: 'openClaw' },
        ]);
      }).pipe(
        Effect.provide(
          Layer.mock(Receipts)({
            acknowledge: (receipt, messageIds, host) =>
              Effect.sync(() => {
                calls.push({
                  receipt,
                  messageIds,
                  host: host ?? 'unspecified',
                });
              }),
          }),
        ),
        Effect.provide(Layer.fresh(TestConsole.layer)),
        Effect.provide(Stdio.layerTest({})),
        Effect.provide(NodeServices.layer),
      );
    },
  );

  it.effect(
    'native agents cannot assert visibility through the manual command',
    () => {
      let acknowledged = false;
      return Effect.gen(function* () {
        for (const host of ['claude', 'codex']) {
          const result = yield* Command.runWith(presentedCommand, {
            version: '0.0.0',
          })(['--receipt', 'snapshot', '--host', host]).pipe(Effect.result);
          assert.strictEqual(result._tag, 'Failure');
        }
        assert.isFalse(acknowledged);
      }).pipe(
        Effect.provide(
          Layer.mock(Receipts)({
            acknowledge: () =>
              Effect.sync(() => {
                acknowledged = true;
              }),
          }),
        ),
        Effect.provide(Layer.fresh(TestConsole.layer)),
        Effect.provide(Stdio.layerTest({})),
        Effect.provide(NodeServices.layer),
      );
    },
  );
});
