/**
 * @file Connects trusted host boundaries to explicit user-visible presentation.
 */

import * as Clock from 'effect/Clock';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as Stdio from 'effect/Stdio';
import * as Stream from 'effect/Stream';
import * as Command from 'effect/unstable/cli/Command';
import * as Flag from 'effect/unstable/cli/Flag';

import { Board, Receipts } from '../../collaboration/presentation/index.js';
import { AgentIdentity, HostObservation } from '../../domain/identity.js';
import { HostHookEvent } from '../../domain/runtime.js';
import { DocumentTemplates } from '../../platform/documents/index.js';
import {
  Paths,
  Storage,
  StorageError,
} from '../../platform/persistence/index.js';

const HookInput = Schema.Struct({
  hook_event_name: Schema.optionalKey(Schema.String),
  stop_hook_active: Schema.optionalKey(Schema.Boolean),
  last_assistant_message: Schema.optionalKey(Schema.NullOr(Schema.String)),
  tool_input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

/** Reports resolved identity and protocol without exposing transport secrets. */
export const contextCommand = Command.make(
  'context',
  { json: Flag.boolean('json') },
  Effect.fn('cli.context')(function* () {
    const paths = yield* Paths;
    const storage = yield* Storage;
    const identity = yield* Schema.decodeUnknownEffect(AgentIdentity)(
      yield* storage.readJson(paths.identityData),
    ).pipe(
      Effect.mapError(() =>
        StorageError.make({
          operation: 'decodeIdentity',
          path: paths.identityData,
        }),
      ),
    );
    yield* Console.log(
      JSON.stringify(
        {
          identity,
          protocol: yield* storage.readText(paths.protocol),
          roster: yield* storage.readText(paths.roster),
          paths: {
            agent: paths.agent,
            norms: paths.norms,
            roster: paths.roster,
          },
        },
        null,
        2,
      ),
    );
  }),
).pipe(
  Command.withDescription(
    'Return the installed identity, collaboration documents, and resolved paths.',
  ),
);

/** Registers a draft for confirmation by the native host's Stop event. */
export const presentCommand = Command.make(
  'present',
  {
    receipt: Flag.string('receipt'),
    messageId: Flag.string('message-id').pipe(Flag.atLeast(0)),
    host: Flag.choice('host', ['claude', 'codex']),
    text: Flag.fileText('text-file'),
  },
  Effect.fn('cli.present')(function* ({ receipt, messageId, host, text }) {
    const receipts = yield* Receipts;
    const pending = yield* receipts.prepare(receipt, host, text, messageId);
    yield* Console.log(
      JSON.stringify({
        ...pending,
        status: 'pending',
        instruction:
          'Emit the exact draft in your final assistant response. The native host confirms visibility after output.',
      }),
    );
  }),
).pipe(
  Command.withDescription(
    'Register a Claude or Codex draft for native visibility confirmation.',
  ),
);

/** Records manual presentation on OpenClaw's supported skill surface. */
export const presentedCommand = Command.make(
  'presented',
  {
    receipt: Flag.string('receipt'),
    messageId: Flag.string('message-id').pipe(Flag.atLeast(0)),
    host: Flag.choice('host', ['openClaw']),
  },
  Effect.fn('cli.presented')(function* ({ receipt, messageId, host }) {
    const receipts = yield* Receipts;
    yield* receipts.acknowledge(receipt, messageId, host);
    yield* Console.log(
      'Presentation recorded. Items remain open until explicit completion.',
    );
  }),
).pipe(
  Command.withDescription(
    'Record an OpenClaw result that was visibly presented.',
  ),
);

/** Injects a trusted pending-update reminder, never untrusted message content. */
export const hostHookCommand = Command.make(
  'host-hook',
  {
    host: Flag.choice('host', ['claude', 'codex', 'native']).pipe(
      Flag.withDefault('native'),
    ),
    event: Flag.choice('event', [
      'SessionStart',
      'UserPromptSubmit',
      'PostToolUse',
      'Stop',
    ]),
  },
  Effect.fn('cli.hostHook')(
    function* ({ event, host }) {
      const board = yield* Board;
      const paths = yield* Paths;
      const storage = yield* Storage;
      if (!(yield* storage.exists(paths.identityData))) {
        return;
      }
      const stdio = yield* Stdio.Stdio;
      const text = yield* stdio.stdin.pipe(
        Stream.decodeText(),
        Stream.mkString,
      );
      const input = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(HookInput),
      )(text.trim() || '{}');
      if (
        event === 'Stop' &&
        input.hook_event_name === 'Stop' &&
        host !== 'native' &&
        typeof input.last_assistant_message === 'string'
      ) {
        const receipts = yield* Receipts;
        yield* receipts.confirm(host, input.last_assistant_message);
      }
      const ownCommand = JSON.stringify(input.tool_input ?? {}).includes(
        'social-harness',
      );
      if (
        input.stop_hook_active === true ||
        (event === 'PostToolUse' && ownCommand)
      ) {
        return;
      }
      if (
        input.hook_event_name === event &&
        (event === 'SessionStart' || event === 'UserPromptSubmit')
      ) {
        const observation = HostObservation.make({
          schemaVersion: 1,
          ...(host === 'native' ? {} : { host }),
          event,
          observedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
        });
        if (host !== 'native') {
          yield* storage.writeJson(
            `${paths.state}/host-observation-${host}.json`,
            observation,
          );
        }
        yield* storage.writeJson(
          `${paths.state}/host-observation.json`,
          observation,
        );
      }
      const result = yield* board.check(
        false,
        true,
        event === 'SessionStart' || event === 'UserPromptSubmit',
      );
      if (!result.shouldPresent) {
        return;
      }
      const templates = yield* DocumentTemplates;
      const hookEventName =
        yield* Schema.decodeUnknownEffect(HostHookEvent)(event);
      const instructions = yield* templates.hostHook();
      const reminder =
        host === 'native'
          ? instructions
          : `${instructions}\nThis reminder came from ${host}. Register your final response with social-harness present --host ${host}.`;
      yield* Console.log(
        JSON.stringify(
          event === 'Stop'
            ? { decision: 'block', reason: reminder }
            : {
                hookSpecificOutput: {
                  hookEventName,
                  additionalContext: reminder,
                },
              },
        ),
      );
    },
    Effect.catch(() => Effect.void),
  ),
).pipe(
  Command.withDescription(
    'Run the installed host hook and emit only trusted reminder context.',
  ),
);
