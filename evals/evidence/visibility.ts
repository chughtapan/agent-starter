/**
 * @file Rejects presentation acknowledgements that precede visible results.
 */

import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';
import { createHash } from 'node:crypto';

import type { NativeConfirmation } from './confirmations.js';

import { Check, type Host, type TestIdentity } from '../domain/index.js';
import { EventValue, Item, Message } from './events.js';

const CommandInput = Schema.Struct({ command: Schema.String });
const ToolText = Schema.Union([
  Schema.String,
  Schema.Array(
    Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  ),
]);
const Snapshot = Schema.Struct({
  receipt: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  rendered: Schema.String.check(Schema.isMinLength(1)),
  updates: Schema.Array(Schema.Struct({ messageId: Schema.String })),
});
const Items = Schema.Array(
  Schema.Struct({
    update: Schema.Struct({
      messageId: Schema.String,
      collaborator: Schema.String,
    }),
    senderEmail: Schema.optionalKey(Schema.String),
    text: Schema.String,
  }),
);
const Registration = Schema.Struct({
  status: Schema.Literal('pending'),
  requestId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  receiptId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  host: Schema.Literals(['claude', 'codex']),
  draftTextHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});

/** Known fixture outcomes are checked before their exact messages are acknowledged. */
export interface VisibilityExpectation {
  readonly source: string;
  readonly kind: 'retry' | 'follow-up';
  readonly messageIds: readonly string[];
}

interface EvidenceState {
  readonly host: Host;
  readonly confirmations: readonly NativeConfirmation[];
  readonly sources: readonly TestIdentity[];
  readonly expectation:
    | { readonly kind: 'none' }
    | { readonly kind: 'result'; readonly value: VisibilityExpectation };
  readonly visible: string[];
  readonly commands: Map<string, string>;
  readonly startedCommands: Set<string>;
  readonly snapshots: Map<
    string,
    { readonly value: typeof Snapshot.Type; readonly visibleAfter: number }
  >;
  readonly items: Map<
    string,
    { readonly source: string; readonly visibleAfter: number }
  >;
  readonly failures: string[];
  readonly blockers: string[];
  readonly registrations: Array<typeof Registration.Type>;
  acknowledgements: number;
  registrationAttempts: number;
  expectedAcknowledged: boolean;
}

interface VisibilityEvidence {
  readonly confirmations: readonly NativeConfirmation[];
  readonly expected?: VisibilityExpectation;
  readonly sources?: readonly TestIdentity[];
}

interface VisibleMessage {
  readonly text: string;
  readonly index: number;
}

/**
 * Grades event order, independently of final prose claims or mailbox labels.
 * @param host Native event format.
 * @param output Captured native JSONL stdout.
 * @param evidence Native Stop confirmations and any required fixture outcome.
 * @returns Failed evidence if any receipt precedes its visible board or result.
 */
export function checkVisibilityProtocol(
  host: Host,
  output: string,
  evidence: VisibilityEvidence = { confirmations: [] },
): Check {
  const state: EvidenceState = {
    host,
    confirmations: evidence.confirmations,
    sources: evidence.sources ?? [],
    expectation:
      evidence.expected === undefined
        ? { kind: 'none' }
        : { kind: 'result', value: evidence.expected },
    visible: [],
    commands: new Map(),
    startedCommands: new Set(),
    snapshots: new Map(),
    items: new Map(),
    failures: [],
    blockers: [],
    registrations: [],
    acknowledgements: 0,
    registrationAttempts: 0,
    expectedAcknowledged: false,
  };
  for (const line of output
    .split('\n')
    .filter((value) => value.trim().length > 0)) {
    const event = Schema.decodeUnknownResult(Schema.fromJsonString(EventValue))(
      line,
    );
    if (Result.isFailure(event)) {
      state.failures.push(
        'A malformed native event prevents proving presentation order.',
      );
      continue;
    }
    if (host === 'claude') {
      inspectClaude(event.success, state);
    } else {
      inspectCodex(event.success, state);
    }
  }
  return visibilityVerdict(state);
}

function visibilityVerdict(state: EvidenceState): Check {
  for (const registration of state.registrations) {
    inspectRegistration(registration, state);
  }
  if (state.registrationAttempts > state.registrations.length) {
    state.blockers.push(
      'A native presentation registration was attempted but no successful command result was observed.',
    );
  }
  if (
    state.expectation.kind === 'result' &&
    !state.expectedAcknowledged &&
    state.blockers.length === 0
  ) {
    state.failures.push(
      'The exact expected peer result was not visibly shown before its acknowledgement.',
    );
  }
  let status: Check['status'] = state.blockers.length > 0 ? 'blocked' : 'pass';
  if (state.failures.length > 0) {
    status = 'fail';
  }
  return Check.make({
    name: 'visibility-before-acknowledgement',
    status,
    detail:
      state.failures[0] ??
      state.blockers[0] ??
      (state.acknowledgements === 0 && state.registrations.length === 0
        ? 'No presentation was registered or acknowledged in this native turn.'
        : 'Native Stop confirmation matches the actual assistant text, exact board, and selected results.'),
  });
}

function inspectClaude(
  event: typeof EventValue.Type,
  state: EvidenceState,
): void {
  if (event.type !== 'assistant' && event.type !== 'user') {
    return;
  }
  const message = Schema.decodeUnknownResult(Message)(event.message);
  if (Result.isFailure(message)) {
    return;
  }
  if (event.type === 'assistant') {
    inspectClaudeAssistant(message.success, state);
  } else {
    inspectClaudeResults(message.success, state);
  }
}

function inspectClaudeAssistant(
  message: typeof Message.Type,
  state: EvidenceState,
): void {
  for (const block of message.content) {
    if (block.type === 'text' && block.text !== undefined) {
      state.visible.push(normalizeText(block.text));
    }
    if (
      block.type === 'tool_use' &&
      block.name === 'Bash' &&
      block.id !== undefined
    ) {
      const command = Schema.decodeUnknownResult(CommandInput)(block.input);
      if (Result.isSuccess(command)) {
        startCommand(block.id, command.success.command, state);
      }
    }
  }
}

function inspectClaudeResults(
  message: typeof Message.Type,
  state: EvidenceState,
): void {
  for (const block of message.content) {
    if (
      block.type !== 'tool_result' ||
      block.tool_use_id === undefined ||
      block.is_error === true
    ) {
      continue;
    }
    const command = state.commands.get(block.tool_use_id);
    const content = Schema.decodeUnknownResult(ToolText)(block.content);
    if (command !== undefined && Result.isSuccess(content)) {
      const text =
        typeof content.success === 'string'
          ? content.success
          : content.success.map((entry) => entry.text).join('\n');
      inspectOutput(text, state);
    }
  }
}

function inspectCodex(
  event: typeof EventValue.Type,
  state: EvidenceState,
): void {
  if (event.type !== 'item.started' && event.type !== 'item.completed') {
    return;
  }
  const decoded = Schema.decodeUnknownResult(Item)(event.item);
  if (Result.isFailure(decoded)) {
    return;
  }
  const item = decoded.success;
  if (
    event.type === 'item.completed' &&
    item.type === 'agent_message' &&
    item.text !== undefined
  ) {
    state.visible.push(normalizeText(item.text));
  }
  if (item.type !== 'command_execution' || item.command === undefined) {
    return;
  }
  // Completed-only command streams still establish a conservative call boundary.
  const id = item.id ?? `event-${String(state.startedCommands.size)}`;
  startCommand(id, item.command, state);
  if (
    event.type === 'item.completed' &&
    item.exit_code === 0 &&
    item.status === 'completed' &&
    item.aggregated_output !== undefined
  ) {
    inspectOutput(item.aggregated_output, state);
  }
}

function startCommand(id: string, command: string, state: EvidenceState): void {
  if (state.startedCommands.has(id)) {
    return;
  }
  state.startedCommands.add(id);
  state.commands.set(id, command);
  if (/\b(?:social-harness|cli\.js)['"]?\s+host-hook\b/.test(command)) {
    state.failures.push(
      'The agent invoked host-hook directly; native evidence must originate from the provider callback.',
    );
  }
  state.registrationAttempts += [
    ...command.matchAll(/\b(?:social-harness|cli\.js)['"]?\s+present\b/g),
  ].length;
  for (const call of command.matchAll(
    /\b(?:social-harness|cli\.js)['"]?\s+presented\b([^\n;&|]*)/g,
  )) {
    inspectAcknowledgement(call[1] ?? '', state);
    state.failures.push(
      'Direct presented assertions cannot establish native Claude or Codex visibility; native Stop confirmation is required.',
    );
  }
}

function inspectOutput(output: string, state: EvidenceState): void {
  // Subprocess wrappers are valid native tools. The canonical request ID and
  // confirmation ledger establish provenance without guessing shell syntax.
  for (const value of structuredOutputs(output)) {
    inspectStructuredOutput(value, state);
  }
}

/**
 * Frames complete top-level objects and arrays without interpreting JSON strings.
 * @param output Successful native tool stdout, possibly with text separators.
 * @returns Decoded documents without recursively promoting nested values.
 */
function structuredOutputs(output: string): unknown[] {
  const values: unknown[] = [];
  let boundary = true;
  let index = 0;
  while (index < output.length) {
    const character = output[index] ?? '';
    if (/\s/.test(character)) {
      boundary = boundary || character === '\n' || character === '\r';
      index++;
      continue;
    }
    if (!boundary || (character !== '{' && character !== '[')) {
      boundary = false;
      index++;
      continue;
    }
    const end = jsonFrameEnd(output, index);
    if (end < 0) {
      break;
    }
    const decoded = Schema.decodeUnknownResult(
      Schema.fromJsonString(Schema.Unknown),
    )(output.slice(index, end));
    if (Result.isSuccess(decoded)) {
      values.push(decoded.success);
    }
    index = end;
    boundary = true;
  }
  return values;
}

function jsonFrameEnd(output: string, start: number): number {
  const closing: string[] = [];
  let index = start;
  while (index < output.length) {
    const character = output[index] ?? '';
    switch (character) {
      case '"':
        index = jsonStringEnd(output, index + 1);
        if (index < 0) {
          return -1;
        }
        continue;
      case '{':
        closing.push('}');
        break;
      case '[':
        closing.push(']');
        break;
      case '}':
      case ']':
        if (closing.pop() !== character) {
          return -1;
        }
        if (closing.length === 0) {
          return index + 1;
        }
        break;
      default:
        break;
    }
    index++;
  }
  return -1;
}

function jsonStringEnd(output: string, start: number): number {
  let escaped = false;
  for (let index = start; index < output.length; index++) {
    const character = output[index] ?? '';
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      return index + 1;
    }
  }
  return -1;
}

function inspectStructuredOutput(value: unknown, state: EvidenceState): void {
  const registration = Schema.decodeUnknownResult(Registration)(value);
  if (Result.isSuccess(registration)) {
    state.registrations.push(registration.success);
  }
  const snapshot = Schema.decodeUnknownResult(Snapshot)(value);
  if (Result.isSuccess(snapshot)) {
    state.snapshots.set(snapshot.success.receipt, {
      value: snapshot.success,
      visibleAfter: state.visible.length,
    });
  }
  const items = Schema.decodeUnknownResult(Items)(value);
  if (Result.isSuccess(items)) {
    for (const item of items.success) {
      const sender = item.senderEmail?.toLowerCase() ?? '';
      const identity = state.sources.find(
        (source) => sender.length > 0 && source.inbox?.toLowerCase() === sender,
      );
      state.items.set(item.update.messageId, {
        source: identity?.name ?? item.update.collaborator,
        visibleAfter: state.visible.length,
      });
    }
  }
}

function inspectRegistration(
  registration: typeof Registration.Type,
  state: EvidenceState,
): void {
  const snapshot = state.snapshots.get(registration.receiptId);
  if (snapshot === undefined || registration.host !== state.host) {
    state.failures.push(
      'A staged presentation lacks its matching updates snapshot or native host.',
    );
    return;
  }
  const board = normalizeText(snapshot.value.rendered).trim();
  const visibleCandidates = state.visible
    .map((text, index) => ({ text, index }))
    .slice(snapshot.visibleAfter)
    .filter((message) => message.text.includes(board));
  if (visibleCandidates.length === 0) {
    state.failures.push(
      'A staged presentation did not appear with its exact board in native assistant text.',
    );
    return;
  }
  const matching = state.confirmations.filter(
    (confirmation) =>
      confirmation.host === state.host &&
      confirmation.receiptId === registration.receiptId &&
      confirmation.pendingRequestId === registration.requestId,
  );
  const pair = matching.flatMap((confirmation) =>
    visibleCandidates
      .filter(
        (message) =>
          confirmation.assistantTextHash ===
          createHash('sha256')
            .update(normalizeText(message.text).trim())
            .digest('hex'),
      )
      .map((message) => ({ confirmation, message })),
  )[0];
  if (pair === undefined) {
    state.blockers.push(
      'Visible assistant text has no matching native Stop confirmation for this host, receipt, and selected messages.',
    );
    return;
  }
  const messageIds = pair.confirmation.visibleMessageIds;
  if (
    !selectedResultsShown(
      pair.message,
      board,
      messageIds,
      snapshot.value,
      state,
    )
  ) {
    state.failures.push(
      'Selected results were confirmed without a current items read and source-bearing assistant text beyond the board.',
    );
    return;
  }
  if (state.expectation.kind === 'result') {
    const expected = state.expectation.value;
    if (
      expected.messageIds.length > 0 &&
      expected.messageIds.every((id) => messageIds.includes(id)) &&
      matchesOutcome(pair.message.text.replaceAll(board, ''), expected)
    ) {
      state.expectedAcknowledged = true;
    }
  }
}

function selectedResultsShown(
  message: VisibleMessage,
  board: string,
  messageIds: readonly string[],
  snapshot: typeof Snapshot.Type,
  state: EvidenceState,
): boolean {
  return messageIds.every((id) => {
    const item = state.items.get(id);
    const result = message.text.replaceAll(board, '').trim();
    return (
      item !== undefined &&
      item.source.length > 0 &&
      snapshot.updates.some((update) => update.messageId === id) &&
      message.index >= item.visibleAfter &&
      result.length > 0 &&
      result.toLowerCase().includes(item.source.toLowerCase())
    );
  });
}

function inspectAcknowledgement(
  argumentsText: string,
  state: EvidenceState,
): void {
  state.acknowledgements++;
  const receipts = flagValues(argumentsText, 'receipt');
  const snapshot =
    receipts.length === 1 ? state.snapshots.get(receipts[0] ?? '') : undefined;
  if (snapshot === undefined) {
    state.failures.push(
      'An acknowledgement has no matching successful updates snapshot in this native turn.',
    );
    return;
  }
  const board = normalizeText(snapshot.value.rendered).trim();
  const visible = state.visible.slice(snapshot.visibleAfter).join('\n\n');
  if (!visible.includes(board)) {
    state.failures.push(
      'A presentation acknowledgement occurred before the exact rendered board appeared in native assistant text.',
    );
    return;
  }
  const messageIds = flagValues(argumentsText, 'message-id');
  const selectedItemsShown = messageIds.every((id) => {
    const item = state.items.get(id);
    if (
      item === undefined ||
      !snapshot.value.updates.some((update) => update.messageId === id)
    ) {
      return false;
    }
    const result = state.visible
      .slice(item.visibleAfter)
      .join('\n\n')
      .replaceAll(board, '')
      .trim();
    return (
      result.length > 0 &&
      item.source.length > 0 &&
      result.toLowerCase().includes(item.source.toLowerCase())
    );
  });
  if (!selectedItemsShown) {
    state.failures.push(
      'Selected messages were acknowledged before retrieval and source-bearing assistant text beyond the board.',
    );
    return;
  }
  if (state.expectation.kind === 'result') {
    const expected = state.expectation.value;
    if (
      expected.messageIds.length === 0 ||
      !expected.messageIds.every((id) => messageIds.includes(id))
    ) {
      return;
    }
    const visibleAfter = Math.max(
      ...expected.messageIds.map(
        (id) => state.items.get(id)?.visibleAfter ?? state.visible.length,
      ),
    );
    const result = state.visible
      .slice(visibleAfter)
      .join('\n\n')
      .replaceAll(board, '');
    if (matchesOutcome(result, expected)) {
      state.expectedAcknowledged = true;
    } else {
      state.failures.push(
        'The expected source and actual fixture outcome were absent from assistant text when the result was acknowledged.',
      );
    }
  }
}

function flagValues(
  argumentsText: string,
  flag: 'receipt' | 'message-id' | 'host',
): string[] {
  const pattern = new RegExp(
    `--${flag}(?:=|\\s+)(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s'";&|]+))`,
    'g',
  );
  return [...argumentsText.matchAll(pattern)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

function matchesOutcome(
  text: string,
  expected: VisibilityExpectation,
): boolean {
  if (!text.toLowerCase().includes(expected.source.toLowerCase())) {
    return false;
  }
  return expected.kind === 'follow-up'
    ? /\b204\b/.test(text)
    : /\b100\b/.test(text) &&
        /\b200\b/.test(text) &&
        /\b(?:success(?:ful(?:ly)?)?|succeeded|succeeds)\b/i.test(text) &&
        /open|mark[^.!?\n]*done|until[^.!?\n]*done/i.test(text);
}

function normalizeText(value: string): string {
  return value.replaceAll('\r\n', '\n');
}
