/**
 * @file Decodes native host streams and grades observed conversation evidence.
 */

import * as Result from 'effect/Result';
import * as Schema from 'effect/Schema';

import {
  Check,
  type Host,
  type MailSnapshot,
  type Transcript,
} from '../domain/index.js';
import { EventValue, Item, Message } from './events.js';

/** Native confirmation reads stay separate from transcript interpretation. */
export {
  NativeConfirmation,
  readNativeConfirmations,
} from './confirmations.js';

/** Native event order is part of the public evidence contract. */
export {
  checkVisibilityProtocol,
  type VisibilityExpectation,
} from './visibility.js';

const ObjectValue = Schema.Record(Schema.String, Schema.Unknown);

interface CollectedTranscript {
  readonly sessionIds: Set<string>;
  readonly visible: string[];
  readonly toolCalls: string[];
  readonly successfulToolCalls: string[];
  readonly pendingTools: Map<string, string>;
  readonly hookEvents: string[];
  readonly nativeErrors: string[];
  malformedLines: number;
}

/**
 * Accepts only native JSON events; malformed lines never become evidence.
 * @param host Native stream format.
 * @param output Captured JSONL stdout.
 * @returns Separated native and visible evidence.
 */
export function parseTranscript(host: Host, output: string): Transcript {
  const collected: CollectedTranscript = {
    sessionIds: new Set(),
    visible: [],
    toolCalls: [],
    successfulToolCalls: [],
    pendingTools: new Map(),
    hookEvents: [],
    nativeErrors: [],
    malformedLines: 0,
  };
  for (const line of output
    .split('\n')
    .filter((entry) => entry.trim().length > 0)) {
    const decoded = Schema.decodeUnknownResult(
      Schema.fromJsonString(EventValue),
    )(line);
    if (Result.isFailure(decoded)) {
      collected.malformedLines++;
      continue;
    }
    collectEvent(host, decoded.success, line, collected);
  }
  return {
    sessionIds: [...collected.sessionIds],
    visible: redact(collected.visible.join('\n\n')),
    toolCalls: collected.toolCalls.map(redact),
    successfulToolCalls: collected.successfulToolCalls.map(redact),
    hookEvents: collected.hookEvents,
    malformedLines: collected.malformedLines,
    nativeErrors: collected.nativeErrors,
  };
}

/**
 * A continuation must name exactly the native ID previously captured.
 * @param transcript Decoded native events.
 * @param expected Previous native ID when resuming.
 * @returns Conversation-continuity verdict.
 */
export function checkSession(transcript: Transcript, expected?: string): Check {
  const actual = transcript.sessionIds[0];
  const valid =
    transcript.sessionIds.length === 1 &&
    actual !== undefined &&
    /^[a-zA-Z0-9-]{8,}$/.test(actual) &&
    (expected === undefined || actual === expected);
  return Check.make({
    name: 'exact-session',
    status: valid ? 'pass' : 'fail',
    detail: valid
      ? 'One native conversation ID captured and preserved.'
      : 'Native conversation ID missing, conflicting, or changed on resume.',
  });
}

/**
 * Counts attempted mail mutations, excluding diagnostic and hook checks.
 * @param transcript Decoded native events.
 * @returns Commands that attempt to mutate collaboration state.
 */
export function mailMutations(transcript: Transcript): readonly string[] {
  const mutations = new Set(['request', 'reply', 'done', 'triage']);
  const onboarding = new Set([
    'run',
    'verify',
    'acknowledge',
    'host-verified',
    'retry-introduction',
  ]);
  return transcript.toolCalls.filter((command) => {
    const calls = command.matchAll(
      /\b(?:social-harness|cli\.js)['"]?\s+([a-z-]+)(?:\s+([a-z-]+))?/gi,
    );
    const harnessMutation = [...calls].some(
      (call) =>
        mutations.has(call[1] ?? '') ||
        (call[1] === 'onboard' && onboarding.has(call[2] ?? '')),
    );
    return (
      harnessMutation ||
      /(?:curl|fetch)\b[^\n]*(?:POST|PATCH|DELETE)/i.test(command)
    );
  });
}

/**
 * Requires visible output and excludes errors and malformed native events.
 * @param transcript Decoded native events.
 * @returns Native-output validity verdict.
 */
export function checkTranscript(transcript: Transcript): Check {
  const valid =
    transcript.visible.trim().length > 0 &&
    transcript.malformedLines === 0 &&
    transcript.nativeErrors.length === 0;
  return Check.make({
    name: 'native-transcript',
    status: valid ? 'pass' : 'fail',
    detail: valid
      ? 'Decoded native assistant output.'
      : 'Missing assistant text, malformed JSON events, or native error.',
  });
}

/**
 * Skill activation is proven by a native tool read or native Skill call.
 * @param transcript Decoded native events.
 * @returns Skill-discovery verdict based on tool evidence.
 */
export function checkDiscovery(transcript: Transcript): Check {
  const loaded = transcript.successfulToolCalls.some((command) =>
    /social-harness[/\\]+SKILL\.md|"skill"\s*:\s*"social-harness"/i.test(
      command,
    ),
  );
  return Check.make({
    name: 'skill-discovery',
    status: loaded ? 'pass' : 'fail',
    detail: loaded
      ? 'Native transcript confirms a successful installed Social Harness skill read.'
      : 'No successful installed skill read found in native tool evidence.',
  });
}

/**
 * Requires the exact delivered results to reach the requested canonical state.
 * @param snapshot Canonical message metadata.
 * @param messageIds IDs established by the delivery checkpoint.
 * @param expected Required visibility or completion state.
 * @param name Evidence check name.
 * @returns A failed check when another unread item masks a missing result.
 */
export function checkMessageState(
  snapshot: MailSnapshot,
  messageIds: readonly string[],
  expected: 'open' | 'presented' | 'done',
  name: string,
): Check {
  const messages = snapshot.threads.flatMap((thread) =>
    thread.messages
      .filter((message) => messageIds.includes(message.message_id))
      .map((message) => ({ message, threadLabels: thread.labels })),
  );
  const matches =
    messages.length === messageIds.length &&
    messages.length > 0 &&
    messages.every(({ message, threadLabels }) => {
      const done = message.labels.includes('sh-done');
      const unread = message.labels.includes('unread');
      return expected === 'done'
        ? done && !unread
        : !done &&
            unread &&
            (expected !== 'presented' ||
              // AgentMail materializes a message-label mutation on the
              // containing thread in some canonical reads. The receipt still
              // binds the selected message ID to native presentation.
              message.labels.includes('sh-presented') ||
              threadLabels.includes('sh-presented'));
    });
  return Check.make({
    name,
    status: matches ? 'pass' : 'fail',
    detail: `Every exact peer result must have canonical ${expected} state; unrelated messages cannot satisfy this check.`,
  });
}

/**
 * Verifies a newly delivered request at the recipient's canonical inbox.
 * @param snapshot Recipient mailbox metadata for the request subject.
 * @param sender Declared requesting agent address.
 * @param recipient Declared receiving agent address.
 * @param owner Required owner-copy address.
 * @param allowed All addresses permitted for this isolated exchange.
 * @returns Delivery verdict that does not depend on a sent-only source copy.
 */
export function checkRequestDelivery(
  snapshot: MailSnapshot,
  sender: string,
  recipient: string,
  owner: string,
  allowed: readonly string[],
): Check {
  const messages = newPeerMessages(snapshot, sender);
  const delivered =
    snapshot.threads.length === 1 &&
    messages.length === 1 &&
    messages.every(
      (message) =>
        message.recipients.includes(recipient.toLowerCase()) &&
        message.recipients.includes(owner.toLowerCase()) &&
        message.recipients.every((address) => allowed.includes(address)),
    );
  return Check.make({
    name: 'request-delivered',
    status: delivered ? 'pass' : 'fail',
    detail:
      'Exactly one request must arrive at the declared peer inbox, within the permitted recipients.',
  });
}

/**
 * Verifies that a peer reply is attached to the delivered request in the
 * receiving mailbox.
 *
 * AgentMail assigns thread identifiers per inbox, so a recipient's thread ID
 * cannot be compared with the sender's. The original request message ID is
 * stable across both inboxes and is the cross-mailbox correlation key.
 * @param snapshot Requester's canonical inbox metadata for the reply subject.
 * @param requestMessageIds IDs observed when the request reached the peer.
 * @param sender Declared responding agent address.
 * @param recipient Declared requesting agent address.
 * @param owner Required responding-owner copy address.
 * @param allowed All addresses permitted for this isolated exchange.
 * @param previous Earlier requester-mailbox metadata, when this is a follow-up.
 * @returns Delivery verdict based on one reply attached to the request.
 */
export function checkPeerReplyDelivery(
  snapshot: MailSnapshot,
  requestMessageIds: readonly string[],
  sender: string,
  recipient: string,
  owner: string,
  allowed: readonly string[],
  previous?: MailSnapshot,
): Check {
  const prior: MailSnapshot = previous ?? { threads: [] };
  const messages = newPeerMessages(snapshot, sender, prior);
  const delivered =
    snapshot.threads.length === 1 &&
    requestMessageIds.length === 1 &&
    messages.length === 1 &&
    snapshot.threads.some(
      (thread) =>
        thread.messages.some((message) =>
          requestMessageIds.includes(message.message_id),
        ) && thread.messages.some((message) => messages.includes(message)),
    ) &&
    messages.every(
      (message) =>
        message.recipients.includes(recipient.toLowerCase()) &&
        message.recipients.includes(owner.toLowerCase()) &&
        message.recipients.every((address) => allowed.includes(address)),
    );
  return Check.make({
    name: 'peer-reply-delivered',
    status: delivered ? 'pass' : 'fail',
    detail:
      'Exactly one peer reply must appear beside the delivered request in the requester inbox, within the permitted recipients.',
  });
}

/**
 * Selects messages that arrived from the peer after the preceding checkpoint.
 * @param snapshot Current canonical metadata.
 * @param sender Declared peer address.
 * @param previous Earlier metadata, when checking a reply or follow-up.
 * @returns Only new messages whose normalized sender matches the peer.
 */
export function newPeerMessages(
  snapshot: MailSnapshot,
  sender: string,
  previous?: MailSnapshot,
) {
  const known = new Set(
    previous?.threads.flatMap((thread) =>
      thread.messages.map((message) => message.message_id),
    ) ?? [],
  );
  return snapshot.threads
    .flatMap((thread) => thread.messages)
    .filter(
      (message) =>
        message.sender === sender.toLowerCase() &&
        !known.has(message.message_id),
    );
}

/**
 * Redacts structured credentials and common token formats in free text.
 * @param value Captured native output or an evidence document.
 * @returns Text safe from supported credential formats.
 */
export function redact(value: string): string {
  return value
    .replace(
      /("(?:[^"\n]*(?:token|secret|password|api[_-]?key)|authorization)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
      '$1"[REDACTED]"',
    )
    .replace(/\bBearer\s+[^\s"'\\]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|am_|ak_)[a-zA-Z0-9_-]{12,}/g, '[REDACTED]')
    .replace(
      /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g,
      '[REDACTED]',
    )
    .replace(
      /((?:ANTHROPIC_API_KEY|OPENAI_API_KEY|CLAUDE_CODE_OAUTH_TOKEN|AGENTMAIL_API_KEY)\s*=\s*)[^\s"']+/g,
      '$1[REDACTED]',
    );
}

function collectEvent(
  host: Host,
  event: typeof EventValue.Type,
  line: string,
  collected: CollectedTranscript,
): void {
  const sessionId = host === 'claude' ? event.session_id : event.thread_id;
  if (sessionId !== undefined) {
    collected.sessionIds.add(sessionId);
  }
  if (
    event.type === 'error' ||
    event.type === 'turn.failed' ||
    event.is_error === true
  ) {
    collected.nativeErrors.push(redact(line));
  }
  if (event.type.includes('hook') || event.subtype?.includes('hook') === true) {
    collected.hookEvents.push(redact(line));
  }
  if (host === 'claude' && event.type === 'assistant') {
    collectClaude(event.message, collected);
  }
  if (host === 'claude' && event.type === 'user') {
    collectClaudeResults(event.message, collected);
  }
  if (host === 'codex' && event.type === 'item.completed') {
    collectCodex(event.item, collected);
  }
}

function collectClaude(value: unknown, collected: CollectedTranscript): void {
  const message = Schema.decodeUnknownResult(Message)(value);
  if (Result.isFailure(message)) {
    collected.malformedLines++;
    return;
  }
  for (const block of message.success.content) {
    if (block.type === 'text' && block.text !== undefined) {
      collected.visible.push(block.text);
    }
    if (block.type === 'tool_use') {
      const command = JSON.stringify({ name: block.name, input: block.input });
      collected.toolCalls.push(command);
      if (block.id !== undefined) {
        collected.pendingTools.set(block.id, command);
      }
    }
  }
}

function collectClaudeResults(
  value: unknown,
  collected: CollectedTranscript,
): void {
  const message = Schema.decodeUnknownResult(Message)(value);
  if (Result.isFailure(message)) {
    return;
  }
  for (const block of message.success.content) {
    if (block.type !== 'tool_result' || block.tool_use_id === undefined) {
      continue;
    }
    const command = collected.pendingTools.get(block.tool_use_id);
    if (command !== undefined && block.is_error !== true) {
      collected.successfulToolCalls.push(command);
    }
    collected.pendingTools.delete(block.tool_use_id);
  }
}

function collectCodex(value: unknown, collected: CollectedTranscript): void {
  const item = Schema.decodeUnknownResult(Item)(value);
  if (Result.isFailure(item)) {
    collected.malformedLines++;
    return;
  }
  if (
    item.success.type === 'agent_message' &&
    item.success.text !== undefined
  ) {
    collected.visible.push(item.success.text);
  }
  if (item.success.command !== undefined) {
    collected.toolCalls.push(item.success.command);
    if (item.success.exit_code === 0 && item.success.status === 'completed') {
      collected.successfulToolCalls.push(item.success.command);
    }
  }
  if (item.success.type === 'mcp_tool_call') {
    const details = Schema.decodeUnknownResult(ObjectValue)(value);
    if (Result.isSuccess(details)) {
      collected.toolCalls.push(JSON.stringify(details.success));
      if (
        item.success.status === 'completed' &&
        item.success.error === undefined
      ) {
        collected.successfulToolCalls.push(JSON.stringify(details.success));
      }
    }
  }
}
