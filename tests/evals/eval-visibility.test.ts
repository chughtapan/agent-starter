/**
 * @file Replays sanitized native event order for owner-visible acknowledgements.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Schema from 'effect/Schema';
import { FastCheck } from 'effect/testing';
import { createHash } from 'node:crypto';

import { type Host, TestIdentity } from '../../evals/domain/index.js';
import {
  checkVisibilityProtocol,
  NativeConfirmation,
  readNativeConfirmations,
  type VisibilityExpectation,
} from '../../evals/evidence/index.js';
import { profileAt } from '../../evals/hosts/index.js';

const receipt = 'a'.repeat(64);
const pendingRequestId = 'b'.repeat(64);
const messageId = 'fixture-result-1';
const board = 'UPDATES\nREADY  Delta  retry verification';
const outcome =
  'Delta reports retries of 100 ms and 200 ms, followed by success. The result remains open until you mark it done.';
const snapshot = { receipt, rendered: board, updates: [{ messageId }] };
const items = [
  {
    update: { messageId, collaborator: 'Delta' },
    text: 'Retries: 100 ms, 200 ms. Final outcome: success.',
  },
];
const expected = {
  source: 'Delta',
  kind: 'retry',
  messageIds: [messageId],
} satisfies VisibilityExpectation;
const noConfirmations = { expected, confirmations: [] };
const acknowledgement = `social-harness presented --host claude --receipt ${receipt} --message-id '${messageId}'`;
const registration = `social-harness present --host claude --receipt ${receipt} --message-id '${messageId}' --text-file /isolated/draft.txt`;

describe('ordered native presentation evidence', () => {
  it('rejects the live failure pattern even when a final claim repeats the board and result', () => {
    const events = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      claudeResult('updates', snapshot),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeCall('ack', acknowledgement),
      claudeResult('ack', 'Presentation recorded. Items remain open.'),
      claudeText(`I showed the board and result.\n${board}\n${outcome}`),
    ];
    const check = checkVisibilityProtocol(
      'claude',
      events.join('\n'),
      noConfirmations,
    );
    assert.equal(check.status, 'fail');
    assert.include(check.detail, 'before the exact rendered board');
  });

  it.prop(
    'accepts a staged draft inside a confirmed assistant event for arbitrary board text',
    [FastCheck.string({ minLength: 1 })],
    ([extra]) => {
      const rendered = `${board}\n${extra}`;
      const text = `Here is the result.\n\`\`\`text\n${rendered}\n\`\`\`\n${outcome}\nI can continue when you are ready.`;
      const events = [
        claudeCall('updates', 'social-harness updates --if-needed --json'),
        claudeResult('updates', { ...snapshot, rendered }),
        claudeCall('items', 'social-harness items'),
        claudeResult('items', items),
        claudeCall('stage', registration),
        claudeResult('stage', staged('claude')),
        claudeText(text),
      ];
      assert.equal(
        checkVisibilityProtocol('claude', events.join('\n'), {
          expected,
          confirmations: [confirmed('claude', text)],
        }).status,
        'pass',
      );
    },
  );

  it('requires result text beyond a faithfully rendered board before selected IDs are acknowledged', () => {
    const events = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      claudeResult('updates', snapshot),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeText(board),
      claudeCall('ack', acknowledgement),
      claudeText(outcome),
    ];
    const check = checkVisibilityProtocol(
      'claude',
      events.join('\n'),
      noConfirmations,
    );
    assert.equal(check.status, 'fail');
    assert.include(check.detail, 'beyond the board');
  });

  it('grades a Codex acknowledgement when the command starts, before its later completion', () => {
    const events = [
      codexCompleted(
        'updates',
        'social-harness updates --if-needed --json',
        snapshot,
      ),
      codexCompleted('items', 'social-harness items', items),
      JSON.stringify({
        type: 'item.started',
        item: {
          id: 'ack',
          type: 'command_execution',
          command: acknowledgement,
        },
      }),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: `${board}\n${outcome}` },
      }),
      codexCompleted('ack', acknowledgement, 'Presentation recorded.'),
    ];
    assert.equal(
      checkVisibilityProtocol('codex', events.join('\n'), noConfirmations)
        .status,
      'fail',
    );
  });

  it('accepts native Codex assistant text but never hidden hook output as visible evidence', () => {
    const ready = [
      codexCompleted(
        'updates',
        'social-harness updates --if-needed --json',
        snapshot,
      ),
      codexCompleted('items', 'social-harness items', items),
      codexCompleted(
        'stage',
        registration.replace('--host claude', '--host codex'),
        staged('codex'),
      ),
    ];
    const hidden = JSON.stringify({
      type: 'system',
      subtype: 'hook_response',
      output: `${board}\n${outcome}`,
    });
    const visible = JSON.stringify({
      type: 'item.completed',
      item: { type: 'agent_message', text: `${board}\n${outcome}` },
    });
    const evidence = {
      expected,
      confirmations: [confirmed('codex', `${board}\n${outcome}`)],
    };
    assert.equal(
      checkVisibilityProtocol('codex', [...ready, hidden].join('\n'), evidence)
        .status,
      'fail',
    );
    assert.equal(
      checkVisibilityProtocol('codex', [...ready, visible].join('\n'), evidence)
        .status,
      'pass',
    );
  });

  it('does not let another acknowledgement or an earlier outcome satisfy a distinct follow-up', () => {
    const events = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      claudeResult('updates', snapshot),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeCall('stage', registration),
      claudeResult('stage', staged('claude')),
      claudeText(`${board}\n${outcome}`),
    ].join('\n');
    assert.equal(
      checkVisibilityProtocol('claude', events, {
        expected: {
          source: 'Delta',
          kind: 'follow-up',
          messageIds: [messageId],
        },
        confirmations: [confirmed('claude', `${board}\n${outcome}`)],
      }).status,
      'fail',
    );
    assert.equal(
      checkVisibilityProtocol('claude', events, {
        expected: { ...expected, messageIds: ['a-different-result'] },
        confirmations: [confirmed('claude', `${board}\n${outcome}`)],
      }).status,
      'fail',
    );
  });

  it('requires a receipt from successful updates output and a current items read', () => {
    const events = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'updates',
              is_error: true,
              content: JSON.stringify(snapshot),
            },
          ],
        },
      }),
      claudeText(`${board}\n${outcome}`),
      claudeCall('ack', acknowledgement),
    ].join('\n');
    const check = checkVisibilityProtocol('claude', events, noConfirmations);
    assert.equal(check.status, 'fail');
    assert.include(check.detail, 'no matching successful updates snapshot');
  });

  it('keeps turns with no acknowledgement separate from required result delivery', () => {
    const events = claudeText('17 + 25 = 42.');
    assert.equal(checkVisibilityProtocol('claude', events).status, 'pass');
    assert.equal(
      checkVisibilityProtocol('claude', events, noConfirmations).status,
      'fail',
    );
  });

  it('requires successful registration, visible text, and the matching host confirmation together', () => {
    const text = `${board}\n${outcome}`;
    const ready = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      claudeResult('updates', snapshot),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeCall('stage', registration),
      claudeResult('stage', staged('claude')),
    ];
    const output = [...ready, claudeText(text)].join('\n');
    assert.equal(
      checkVisibilityProtocol('claude', output, noConfirmations).status,
      'blocked',
    );
    assert.equal(
      checkVisibilityProtocol('claude', output, {
        expected,
        confirmations: [confirmed('codex', text)],
      }).status,
      'blocked',
    );
    assert.equal(
      checkVisibilityProtocol('claude', output, {
        expected,
        confirmations: [confirmed('claude', 'A different assistant message.')],
      }).status,
      'blocked',
    );
    assert.equal(
      checkVisibilityProtocol('claude', output, {
        expected,
        confirmations: [confirmed('claude', text, 'd'.repeat(64))],
      }).status,
      'blocked',
    );
    assert.equal(
      checkVisibilityProtocol(
        'claude',
        [...ready, claudeText('I showed the result.')].join('\n'),
        { expected, confirmations: [confirmed('claude', text)] },
      ).status,
      'fail',
    );
    assert.equal(
      checkVisibilityProtocol('claude', output, {
        expected,
        confirmations: [confirmed('claude', text)],
      }).status,
      'pass',
    );
  });

  it('normalizes CRLF and surrounding whitespace without changing internal content', () => {
    const text = `  ${board.replaceAll('\n', '\r\n')}\r\n${outcome}  `;
    const events = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      claudeResult('updates', snapshot),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeCall('stage', registration),
      claudeResult('stage', staged('claude')),
      claudeText(text),
    ].join('\n');
    assert.equal(
      checkVisibilityProtocol('claude', events, {
        expected,
        confirmations: [confirmed('claude', text)],
      }).status,
      'pass',
    );
    assert.equal(
      checkVisibilityProtocol('claude', events, {
        expected,
        confirmations: [confirmed('claude', text.replace('100 ms', '500 ms'))],
      }).status,
      'blocked',
    );
  });

  it.effect(
    'excludes legacy, stale, future, and other-host acknowledgements from the turn oracle',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({
          prefix: 'native-confirmation-eval-',
        });
        const profile = profileAt(root, 'claude');
        const directory = `${profile.harness}/state/acknowledgements`;
        yield* fs.makeDirectory(directory, { recursive: true });
        const since = Date.now() - 1000;
        const current = confirmed('claude', `${board}\n${outcome}`);
        const record = yield* Schema.encodeEffect(NativeConfirmation)(current);
        yield* fs.writeFileString(
          `${directory}/${'1'.repeat(64)}.json`,
          JSON.stringify(current),
        );
        yield* fs.writeFileString(
          `${directory}/${'2'.repeat(64)}.json`,
          JSON.stringify({
            ...record,
            nativeConfirmed: undefined,
            assistantTextHash: undefined,
            pendingRequestId: undefined,
          }),
        );
        yield* fs.writeFileString(
          `${directory}/${'3'.repeat(64)}.json`,
          JSON.stringify({
            ...record,
            presentedAt: new Date(since - 1000).toISOString(),
          }),
        );
        yield* fs.writeFileString(
          `${directory}/${'4'.repeat(64)}.json`,
          JSON.stringify({ ...record, host: 'codex' }),
        );
        yield* fs.writeFileString(
          `${directory}/${'5'.repeat(64)}.json`,
          JSON.stringify({
            ...record,
            presentedAt: new Date(Date.now() + 60_000).toISOString(),
          }),
        );
        assert.deepEqual(yield* readNativeConfirmations(profile, since), [
          current,
        ]);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it('correlates structured subprocess results without guessing shell argument syntax', () => {
    const text = `${board}\n${outcome}`;
    const events = [
      codexCompleted(
        'updates',
        "python3 -c 'import subprocess; subprocess.run([candidate, operation])'",
        snapshot,
      ),
      codexCompleted(
        'items',
        "python3 -c 'import subprocess; subprocess.run([candidate, operation])'",
        items,
      ),
      codexCompleted(
        'stage',
        "python3 -c 'import subprocess; subprocess.run([candidate, operation, receipt])'",
        staged('codex'),
      ),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text },
      }),
    ].join('\n');
    assert.equal(
      checkVisibilityProtocol('codex', events, {
        expected,
        confirmations: [confirmed('codex', text)],
      }).status,
      'pass',
    );
    assert.equal(
      checkVisibilityProtocol('codex', events, {
        expected,
        confirmations: [confirmed('codex', text, 'd'.repeat(64))],
      }).status,
      'blocked',
    );
  });

  it('accepts the live batched updates and context output without losing the receipt', () => {
    const text = `${board}\n${outcome}`;
    const context = {
      identity: { agentName: 'Fixture agent' },
      notes: ['A quoted closing brace: "}".', { nested: ['{', '[\\]'] }],
      protocol: 'Keep this string literal: \\"nested [braces] {here}\\".',
    };
    const events = [
      claudeCall(
        'updates-context',
        'social-harness updates --if-needed --json; echo "---"; social-harness context --json',
      ),
      claudeResult(
        'updates-context',
        `${JSON.stringify(snapshot, null, 2)}\n---\n${JSON.stringify(context, null, 2)}\n`,
      ),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeCall('stage', registration),
      claudeResult('stage', staged('claude')),
      claudeText(text),
    ].join('\n');
    assert.equal(
      checkVisibilityProtocol('claude', events, {
        expected,
        confirmations: [confirmed('claude', text)],
      }).status,
      'pass',
    );
    assert.equal(
      checkVisibilityProtocol('claude', events, noConfirmations).status,
      'blocked',
    );
  });

  it.prop(
    'frames batched objects and arrays while preserving arbitrary nested and quoted JSON values',
    [
      FastCheck.jsonValue(),
      FastCheck.string(),
      FastCheck.constantFrom(
        '\n---\n',
        '\r\nseparator: literal {braces}\r\n',
        '',
      ),
    ],
    ([nested, extra, separator]) => {
      const rendered = `${board}\n${extra}`;
      const text = `${rendered}\n${outcome}`;
      for (const host of ['claude', 'codex'] satisfies Host[]) {
        const stdout = [
          { ...snapshot, rendered },
          { unrelated: { nested, escaped: '\\" } ] { [ \\"' } },
          items,
          staged(host),
        ]
          .map((value) => JSON.stringify(value, null, 2))
          .join(separator);
        const stagedCommand = registration.replace(
          '--host claude',
          `--host ${host}`,
        );
        const command = `social-harness updates --json; social-harness context --json; social-harness items; ${stagedCommand}`;
        const events =
          host === 'claude'
            ? [
                claudeCall('batch', command),
                claudeResult('batch', stdout),
                claudeText(text),
              ]
            : [
                codexCompleted('batch', command, stdout),
                JSON.stringify({
                  type: 'item.completed',
                  item: { type: 'agent_message', text },
                }),
              ];
        assert.equal(
          checkVisibilityProtocol(host, events.join('\n'), {
            expected,
            confirmations: [confirmed(host, text)],
          }).status,
          'pass',
        );
      }
    },
  );

  it('does not promote nested or quoted snapshots to top-level command evidence', () => {
    const text = `${board}\n${outcome}`;
    for (const output of [
      JSON.stringify({ nested: snapshot, quoted: JSON.stringify(snapshot) }),
      `Unrelated diagnostic: ${JSON.stringify(snapshot)}\n`,
      `${JSON.stringify({ nested: snapshot }).slice(0, -1)}\n`,
    ]) {
      const events = [
        claudeCall('updates', 'social-harness updates --json'),
        claudeResult('updates', output),
        claudeCall('items', 'social-harness items'),
        claudeResult('items', items),
        claudeCall('stage', registration),
        claudeResult('stage', staged('claude')),
        claudeText(text),
      ].join('\n');
      assert.equal(
        checkVisibilityProtocol('claude', events, {
          expected,
          confirmations: [confirmed('claude', text)],
        }).status,
        'fail',
      );
    }
  });

  it('rejects agent-issued hook commands even if a resulting confirmation would otherwise match', () => {
    const text = `${board}\n${outcome}`;
    const events = [
      claudeCall('updates', 'social-harness updates --if-needed --json'),
      claudeResult('updates', snapshot),
      claudeCall('items', 'social-harness items'),
      claudeResult('items', items),
      claudeCall('stage', registration),
      claudeResult('stage', staged('claude')),
      claudeText(text),
      claudeCall('forged-hook', 'social-harness host-hook --event Stop'),
      claudeResult('forged-hook', 'Hook completed.'),
    ].join('\n');
    const check = checkVisibilityProtocol('claude', events, {
      expected,
      confirmations: [confirmed('claude', text)],
    });
    assert.equal(check.status, 'fail');
    assert.include(check.detail, 'invoked host-hook directly');
  });

  it('attributes a provider display name through the exact declared sender inbox', () => {
    const text = `${board}\n${outcome}`;
    const events = [
      codexCompleted(
        'updates',
        'social-harness updates --force --json',
        snapshot,
      ),
      codexCompleted('items', 'social-harness items', [
        {
          update: { messageId, collaborator: 'AgentMail <delta@example.test>' },
          senderEmail: 'delta@example.test',
          text: 'Retries: 100 ms, 200 ms. Final outcome: success.',
        },
      ]),
      codexCompleted(
        'stage',
        registration.replace('--host claude', '--host codex'),
        staged('codex'),
      ),
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text },
      }),
    ].join('\n');
    const confirmations = [confirmed('codex', text)];
    assert.equal(
      checkVisibilityProtocol('codex', events, { expected, confirmations })
        .status,
      'fail',
    );
    assert.equal(
      checkVisibilityProtocol('codex', events, {
        expected,
        confirmations,
        sources: [
          TestIdentity.make({ name: 'Delta', inbox: 'delta@example.test' }),
        ],
      }).status,
      'pass',
    );
    assert.equal(
      checkVisibilityProtocol('codex', events, {
        expected,
        confirmations,
        sources: [
          TestIdentity.make({ name: 'Delta', inbox: 'elsewhere@example.test' }),
        ],
      }).status,
      'fail',
    );
  });
});

function staged(host: Host) {
  return {
    status: 'pending',
    requestId: pendingRequestId,
    receiptId: receipt,
    host,
    draftTextHash: 'c'.repeat(64),
  };
}

function confirmed(
  host: Host,
  text: string,
  requestId: string = pendingRequestId,
): NativeConfirmation {
  return NativeConfirmation.make({
    schemaVersion: 1,
    receiptId: receipt,
    host,
    presentedAt: new Date().toISOString(),
    visibleMessageIds: [messageId],
    nativeConfirmed: true,
    assistantTextHash: createHash('sha256')
      .update(text.replaceAll('\r\n', '\n').trim())
      .digest('hex'),
    pendingRequestId: requestId,
  });
}

function claudeCall(id: string, command: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }],
    },
  });
}

function claudeResult(id: string, content: unknown): string {
  return JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content:
            typeof content === 'string' ? content : JSON.stringify(content),
        },
      ],
    },
  });
}

function claudeText(text: string): string {
  return JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  });
}

function codexCompleted(id: string, command: string, content: unknown): string {
  return JSON.stringify({
    type: 'item.completed',
    item: {
      id,
      type: 'command_execution',
      command,
      aggregated_output:
        typeof content === 'string' ? content : JSON.stringify(content),
      status: 'completed',
      exit_code: 0,
    },
  });
}
