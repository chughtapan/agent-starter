/**
 * @file Orchestrates isolated real-agent scenarios and stores reviewable evidence.
 */

import type * as PlatformError from 'effect/PlatformError';

import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';
import * as Result from 'effect/Result';
import * as Schedule from 'effect/Schedule';
import * as Schema from 'effect/Schema';
import { createHash, randomUUID } from 'node:crypto';

import { trustOwnedCodexHooks } from './codex-trust/index.js';
import {
  Check,
  EvaluationError,
  type EvaluationOptions,
  type Host,
  type MailSnapshot,
  PairFixture,
  type Profile,
  type TestIdentity,
  type Transcript,
} from './domain/index.js';
import {
  checkDiscovery,
  checkMessageState,
  checkPeerReplyDelivery,
  checkRequestDelivery,
  checkSession,
  checkTranscript,
  checkVisibilityProtocol,
  mailMutations,
  newPeerMessages,
  parseTranscript,
  readNativeConfirmations,
  redact,
  type VisibilityExpectation,
} from './evidence/index.js';
import {
  checkNativePermissions,
  hostArguments,
  HostProcesses,
  initializeRoot,
  prepareNativePermissions,
  prepareShellPath,
  profileAt,
  seedCodexAuthentication,
  verifyContainment,
} from './hosts/index.js';
import { snapshotMail, verifyMailIdentity } from './mail-evidence.js';

const ObjectValue = Schema.Record(Schema.String, Schema.Unknown);
const ClaudeAuth = Schema.Struct({ loggedIn: Schema.Boolean });
const Observation = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  host: Schema.Literals(['claude', 'codex']),
  event: Schema.String,
  observedAt: Schema.String,
});

interface Turn {
  readonly transcript: Transcript;
  readonly sessionId: string;
}

type Conversation =
  | { readonly kind: 'new' }
  | { readonly kind: 'resume'; readonly id: string };

type Presentation =
  | { readonly kind: 'observe' }
  | { readonly kind: 'require'; readonly outcome: VisibilityExpectation };

/**
 * Builds the bounded synchronization command used between native host turns.
 * @param runtime Candidate CLI module path.
 * @returns Arguments that run one poll without starting another scheduler.
 */
export function oneShotPollArguments(runtime: string): readonly string[] {
  return [runtime, 'poll', '--once'];
}

/** Saves nonsecret evidence privately; raw child streams never reach stdout. */
const writeEvidence = Effect.fn('evals.writeEvidence')(function* (
  filename: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.writeFileString(filename, redact(content), { mode: 0o600 });
});

const persistChecks = Effect.fn('evals.persistChecks')(function* (
  directory: string,
  checks: readonly Check[],
) {
  yield* writeEvidence(
    `${directory}/checks.json`,
    JSON.stringify(checks, null, 2),
  );
});

/** Prepares only the isolated install; it never onboards or imports credentials. */
const prepareProfile = Effect.fn('evals.prepareProfile')(function* (
  profile: Profile,
  runtime: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const processes = yield* HostProcesses;
  const existing = yield* processes.run(
    profile,
    process.execPath,
    [runtime, 'config', 'show'],
    15,
  );
  if (existing.exitCode !== 0) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'prepare',
        reason: 'Candidate runtime could not load the isolated configuration.',
      }),
    );
  }
  const config = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(ObjectValue),
  )(existing.stdout);
  const prepared = {
    ...config,
    adapters: {
      claude: { mode: profile.host === 'claude' ? 'enabled' : 'disabled' },
      codex: { mode: profile.host === 'codex' ? 'enabled' : 'disabled' },
      openClaw: { mode: 'disabled' },
    },
    notifications: { enabled: false, openHost: 'auto' },
    softwareUpdates: { enabled: false, checkInterval: 'PT24H' },
  };
  yield* fs.writeFileString(
    `${profile.harness}/config.json`,
    JSON.stringify(prepared, null, 2),
    { mode: 0o600 },
  );
  const installed = yield* processes.run(
    profile,
    process.execPath,
    [runtime, 'repair', '--adapters-only'],
    30,
  );
  yield* writeEvidence(`${profile.home}/installation.json`, installed.stdout);
  if (installed.exitCode !== 0) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'prepare',
        reason:
          'Candidate adapter installation failed inside its isolated home.',
      }),
    );
  }
  yield* fs.writeFileString(
    `${profile.workspace}/retry.log`,
    yield* fs.readFileString(
      yield* path.fromFileUrl(
        new URL('../evals/fixtures/retry.log', import.meta.url),
      ),
    ),
    { mode: 0o600 },
  );
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const prepareRuntime = Effect.fn('evals.prepareRuntime')(function* (
  root: string,
  runtime: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const launcher = `${root}/bin/social-harness`;
  yield* fs.writeFileString(
    launcher,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(runtime)} "$@"\n`,
    { mode: 0o700 },
  );
  yield* fs.chmod(launcher, 0o700);
  for (const host of ['claude', 'codex'] satisfies Host[]) {
    const profile = profileAt(root, host);
    yield* prepareShellPath(profile, `${root}/bin`);
    yield* prepareProfile(profile, runtime);
    yield* prepareNativePermissions(profile);
  }
});

const checkCandidate = Effect.fn('evals.checkCandidate')(function* (
  profile: Profile,
  expectedPath: string,
) {
  const processes = yield* HostProcesses;
  const candidate = yield* processes
    .run(profile, '/bin/zsh', ['-lc', 'command -v social-harness'], 10)
    .pipe(Effect.result);
  return Check.make({
    name: `${profile.host}:candidate-cli`,
    status:
      Result.isSuccess(candidate) &&
      candidate.success.exitCode === 0 &&
      candidate.success.stdout.trim() === expectedPath
        ? 'pass'
        : 'blocked',
    detail:
      'Native login-shell command resolution must select this evaluation root’s candidate CLI; use --prepare to install its owned PATH block.',
  });
});

const preflightHost = Effect.fn('evals.preflightHost')(function* (
  root: string,
  host: Host,
  reuseNativeAuth: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const processes = yield* HostProcesses;
  const profile = profileAt(root, host, reuseNativeAuth);
  const checks: Check[] = [
    yield* checkCandidate(profile, `${root}/bin/social-harness`),
    yield* checkNativePermissions(profile),
  ];
  const version = yield* processes
    .run(profile, host, ['--version'], 10)
    .pipe(Effect.result);
  checks.push(
    Check.make({
      name: `${host}:binary`,
      status:
        Result.isSuccess(version) && version.success.exitCode === 0
          ? 'pass'
          : 'blocked',
      detail: Result.isSuccess(version)
        ? redact(version.success.stdout.trim()).slice(0, 120) ||
          'Version unavailable.'
        : 'Native host executable unavailable.',
    }),
  );
  const auth = yield* processes
    .run(
      profile,
      host,
      host === 'claude' ? ['auth', 'status', '--json'] : ['login', 'status'],
      10,
    )
    .pipe(Effect.result);
  let authenticated = false;
  if (Result.isSuccess(auth) && auth.success.exitCode === 0) {
    if (host === 'claude') {
      const decoded = Schema.decodeUnknownResult(
        Schema.fromJsonString(ClaudeAuth),
      )(auth.success.stdout);
      authenticated = Result.isSuccess(decoded) && decoded.success.loggedIn;
    } else {
      authenticated = /logged in/i.test(
        `${auth.success.stdout}\n${auth.success.stderr}`,
      );
    }
  }
  checks.push(
    Check.make({
      name: `${host}:auth`,
      status: authenticated ? 'pass' : 'blocked',
      detail: authenticationDetail(authenticated, reuseNativeAuth),
    }),
  );
  const skill =
    host === 'claude'
      ? `${profile.home}/.claude/skills/social-harness/SKILL.md`
      : `${profile.home}/.agents/skills/social-harness/SKILL.md`;
  const skillPresent = yield* fs.exists(skill);
  checks.push(
    Check.make({
      name: `${host}:skill-file`,
      status: skillPresent ? 'pass' : 'blocked',
      detail: skillPresent
        ? 'Skill file is present in the isolated host home; native activation remains to be observed.'
        : 'Installed skill is missing from the isolated host home; use --prepare first.',
    }),
  );
  checks.push(
    Check.make({
      name: `${host}:hook-execution`,
      status: 'blocked',
      detail:
        'Native hook execution remains to be observed in an actual scenario; saved trust alone does not establish execution.',
    }),
  );
  return checks;
});

function authenticationDetail(
  authenticated: boolean,
  reuseNativeAuth: boolean,
): string {
  if (authenticated) {
    return 'Native auth status succeeded inside the isolated profile.';
  }
  if (reuseNativeAuth) {
    return 'Existing login reuse failed. Check the native login; an expired Codex snapshot requires deliberate replacement in the eval profile.';
  }
  return 'Authenticate this isolated native profile or explicitly use --reuse-native-auth.';
}

const runTurn = Effect.fn('evals.runTurn')(function* (
  profile: Profile,
  prompt: string,
  directory: string,
  name: string,
  timeoutSeconds: number,
  checks: Check[],
  conversation: Conversation,
  presentation: Presentation = { kind: 'observe' },
  sources: readonly TestIdentity[] = [],
): Effect.fn.Return<
  Turn,
  EvaluationError | PlatformError.PlatformError,
  HostProcesses | FileSystem.FileSystem | Path.Path
> {
  const processes = yield* HostProcesses;
  yield* verifyContainment(`${profile.home}/../..`);
  yield* writeEvidence(`${directory}/${name}.prompt.txt`, prompt);
  yield* Console.log(`${profile.host}: ${name}`);
  const args =
    conversation.kind === 'new'
      ? hostArguments(profile, prompt)
      : hostArguments(profile, prompt, conversation.id);
  const startedAt = Date.now();
  const output = yield* processes.run(
    profile,
    profile.host,
    args,
    timeoutSeconds,
  );
  yield* writeEvidence(`${directory}/${name}.events.jsonl`, output.stdout);
  yield* writeEvidence(`${directory}/${name}.stderr.txt`, output.stderr);
  yield* verifyContainment(`${profile.home}/../..`);
  const confirmations = yield* readNativeConfirmations(profile, startedAt);
  yield* writeEvidence(
    `${directory}/${name}.confirmations.json`,
    JSON.stringify(confirmations, null, 2),
  );
  const transcript = parseTranscript(profile.host, output.stdout);
  yield* writeEvidence(`${directory}/${name}.visible.txt`, transcript.visible);
  yield* writeEvidence(
    `${directory}/${name}.decoded.json`,
    JSON.stringify(transcript, null, 2),
  );
  const processCheck = Check.make({
    name: `${name}:process`,
    status: !output.timedOut && output.exitCode === 0 ? 'pass' : 'blocked',
    detail: output.timedOut
      ? 'Native host timed out; partial evidence retained.'
      : `Native process exit code ${String(output.exitCode)}.`,
  });
  const sessionCheck =
    conversation.kind === 'new'
      ? checkSession(transcript)
      : checkSession(transcript, conversation.id);
  const visibilityCheck =
    presentation.kind === 'observe'
      ? checkVisibilityProtocol(profile.host, output.stdout, {
          confirmations,
          sources,
        })
      : checkVisibilityProtocol(profile.host, output.stdout, {
          confirmations,
          expected: presentation.outcome,
          sources,
        });
  const turnChecks = [
    processCheck,
    checkTranscript(transcript),
    sessionCheck,
    visibilityCheck,
  ];
  checks.push(...turnChecks);
  yield* persistChecks(directory, checks);
  const actualId = transcript.sessionIds[0];
  if (
    turnChecks.some((check) => check.status !== 'pass') ||
    actualId === undefined
  ) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'turn',
        reason:
          'Native turn failed its process, continuity, transcript, or presentation-order check; inspect retained checks before continuing.',
      }),
    );
  }
  return { transcript, sessionId: actualId };
});

const checkHookObservation = Effect.fn('evals.checkHookObservation')(function* (
  profile: Profile,
  since: number,
) {
  const fs = yield* FileSystem.FileSystem;
  const filename = `${profile.harness}/state/host-observation-${profile.host}.json`;
  if (!(yield* fs.exists(filename))) {
    return Check.make({
      name: `${profile.host}:native-hook`,
      status: 'blocked',
      detail:
        'No native hook observation; onboarding identity or native hook trust may still be missing.',
    });
  }
  const observation = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Observation),
  )(yield* fs.readFileString(filename));
  const matchesHost = observation.host === profile.host;
  const recent = matchesHost && Date.parse(observation.observedAt) >= since;
  let detail = 'Only a stale or invalid hook observation exists.';
  if (!matchesHost) {
    detail = 'Hook observation originated from a different host.';
  } else if (recent) {
    detail = `Observed ${profile.host} ${observation.event} during this scenario.`;
  }
  return Check.make({
    name: `${profile.host}:native-hook`,
    status: recent ? 'pass' : 'fail',
    detail,
  });
});

const runGenericNegative = Effect.fn('evals.runGenericNegative')(function* (
  profile: Profile,
  options: EvaluationOptions,
  directory: string,
  checks: Check[],
) {
  let turn = yield* runTurn(
    profile,
    'Our task is arithmetic. Calculate 17 + 25 and explain the addition.',
    directory,
    `${profile.host}-arithmetic`,
    options.timeoutSeconds,
    checks,
    { kind: 'new' },
  );
  checks.push(
    Check.make({
      name: `${profile.host}:arithmetic-context`,
      status:
        /\b42\b/.test(turn.transcript.visible) &&
        mailMutations(turn.transcript).length === 0
          ? 'pass'
          : 'fail',
      detail:
        'The unrelated arithmetic task must be answered without authorizing a mail mutation.',
    }),
  );
  for (const [index, prompt] of [
    'status',
    'what are you working on?',
    'inbox',
    'team',
  ].entries()) {
    turn = yield* runTurn(
      profile,
      prompt,
      directory,
      `${profile.host}-generic-${String(index + 1)}`,
      options.timeoutSeconds,
      checks,
      { kind: 'resume', id: turn.sessionId },
    );
    checks.push(
      Check.make({
        name: `${profile.host}:generic-${String(index + 1)}`,
        status: mailMutations(turn.transcript).length === 0 ? 'pass' : 'fail',
        detail: 'Generic words must not authorize a collaboration mutation.',
      }),
    );
  }
});

const runReadOnly = Effect.fn('evals.runReadOnly')(function* (
  options: EvaluationOptions,
  root: string,
  directory: string,
  checks: Check[],
) {
  for (const host of ['claude', 'codex'] satisfies Host[]) {
    const profile = profileAt(root, host, options.reuseNativeAuth);
    const started = Date.now();
    if (options.scenario === 'skill-discovery') {
      const turn = yield* runTurn(
        profile,
        'Use the installed Social Harness skill to explain when it should activate and when collaboration work becomes done. Read the installed skill. This is a read-only skill-discovery check: do not set up, send, reply, triage, mark done, read credentials, or inspect mail.',
        directory,
        `${host}-discovery`,
        options.timeoutSeconds,
        checks,
        { kind: 'new' },
      );
      checks.push(
        checkDiscovery(turn.transcript),
        Check.make({
          name: `${host}:no-mail-mutation`,
          status: mailMutations(turn.transcript).length === 0 ? 'pass' : 'fail',
          detail:
            'Read-only discovery must not send, reply, triage, onboard, or complete work.',
        }),
      );
    } else {
      yield* runGenericNegative(profile, options, directory, checks);
    }
    checks.push(yield* checkHookObservation(profile, started));
  }
});

const requireCheckpoints = Effect.fn('evals.requireCheckpoints')(function* (
  directory: string,
  checks: readonly Check[],
) {
  yield* persistChecks(directory, checks);
  if (checks.some((check) => check.status !== 'pass')) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'checkpoint',
        reason:
          'A required observation failed; subsequent mail actions were stopped without retrying the send.',
      }),
    );
  }
});

const captureMail = Effect.fn('evals.captureMail')(function* (
  profile: Profile,
  marker: string,
  directory: string,
  name: string,
  ready?: (snapshot: MailSnapshot) => boolean,
) {
  const snapshot = yield* snapshotMail(profile, marker).pipe(
    Effect.repeat({
      times: 5,
      schedule: Schedule.spaced('1 second'),
      until: ready ?? (() => true),
    }),
  );
  yield* writeEvidence(
    `${directory}/${name}.labels.json`,
    JSON.stringify(snapshot, null, 2),
  );
  return snapshot;
});

const pollProfile = Effect.fn('evals.pollProfile')(function* (
  profile: Profile,
  runtime: string,
) {
  const processes = yield* HostProcesses;
  const output = yield* processes.run(
    profile,
    process.execPath,
    oneShotPollArguments(runtime),
    30,
  );
  if (output.exitCode !== 0) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'poll',
        reason:
          'The isolated runtime could not synchronize the dedicated mailbox.',
      }),
    );
  }
});

/** Mail is exchanged only after declarations and local identities match. */
const runRoundtrip = Effect.fn('evals.runRoundtrip')(function* (
  options: EvaluationOptions,
  root: string,
  fixture: PairFixture,
  directory: string,
  checks: Check[],
) {
  if (
    !fixture.dedicatedTestIdentities ||
    fixture.claude.ownerEmail === fixture.codex.ownerEmail ||
    fixture.claude.inbox === fixture.codex.inbox
  ) {
    return yield* Effect.fail(
      EvaluationError.make({
        operation: 'identity',
        reason:
          'Mail scenarios require two distinct owner aliases and two dedicated test inboxes.',
      }),
    );
  }
  const claude = profileAt(root, 'claude', options.reuseNativeAuth);
  const codex = profileAt(root, 'codex', options.reuseNativeAuth);
  const sources = [fixture.claude, fixture.codex];
  const allowedEmails = [
    fixture.claude.ownerEmail,
    fixture.codex.ownerEmail,
    fixture.claude.inbox,
    fixture.codex.inbox,
  ].filter((email) => email !== undefined);
  yield* verifyMailIdentity(
    claude,
    fixture.claude,
    allowedEmails,
    fixture.codex,
  );
  yield* verifyMailIdentity(
    codex,
    fixture.codex,
    allowedEmails,
    fixture.claude,
  );
  const marker = `eval-${randomUUID()}`;
  const started = Date.now();
  const sent = yield* runTurn(
    claude,
    `Ask ${fixture.codex.name}’s agent to review the test-only retry.log in its workspace and report the retry delays and final outcome. Use subject ${marker}. Copy my owner at ${fixture.claude.ownerEmail ?? ''}. I authorize only this dedicated test exchange, with ${fixture.codex.inbox ?? ''} and the two declared test owners. Follow my installed identity, autonomy, protocol, and roster. Never read credentials.`,
    directory,
    'request',
    options.timeoutSeconds,
    checks,
    { kind: 'new' },
    { kind: 'observe' },
    sources,
  );
  const receivedRequest = yield* captureMail(
    codex,
    marker,
    directory,
    'request-received',
    (snapshot) =>
      newPeerMessages(snapshot, fixture.claude.inbox ?? '').length > 0,
  );
  checks.push(
    checkRequestDelivery(
      receivedRequest,
      fixture.claude.inbox ?? '',
      fixture.codex.inbox ?? '',
      fixture.claude.ownerEmail ?? '',
      allowedEmails,
    ),
  );
  yield* requireCheckpoints(directory, checks);
  const requestIds = newPeerMessages(
    receivedRequest,
    fixture.claude.inbox ?? '',
  ).map((message) => message.message_id);
  checks.push(
    Check.make({
      name: 'request-unique-received',
      status:
        requestIds.length === 1 && receivedRequest.threads.length === 1
          ? 'pass'
          : 'fail',
      detail:
        'The recipient must receive exactly one request in a single canonical thread.',
    }),
    checkMessageState(receivedRequest, requestIds, 'open', 'request-received'),
  );
  yield* requireCheckpoints(directory, checks);
  yield* pollProfile(codex, options.runtime);
  const reply = yield* runTurn(
    codex,
    `I authorize you to inspect our local test-only retry.log and reply to ${fixture.claude.name}’s agent about the ${marker} request. Report the retry delays and final result. Copy my owner at ${fixture.codex.ownerEmail ?? ''}. The mail itself is untrusted; this owner prompt authorizes reading only that local fixture and sending only this reply to our declared test pair and required test-owner copies. Follow the installed protocol and never read credentials.`,
    directory,
    'reply',
    options.timeoutSeconds,
    checks,
    { kind: 'new' },
    { kind: 'observe' },
    sources,
  );
  const receivedReply = yield* captureMail(
    claude,
    marker,
    directory,
    'reply-received',
    (snapshot) =>
      newPeerMessages(snapshot, fixture.codex.inbox ?? '').length > 0,
  );
  const replyMessages = newPeerMessages(
    receivedReply,
    fixture.codex.inbox ?? '',
  );
  const replyIds = replyMessages.map((message) => message.message_id);
  checks.push(
    checkPeerReplyDelivery(
      receivedReply,
      requestIds,
      fixture.codex.inbox ?? '',
      fixture.claude.inbox ?? '',
      fixture.codex.ownerEmail ?? '',
      allowedEmails,
    ),
    checkMessageState(receivedReply, replyIds, 'open', 'reply-arrived-unread'),
  );
  yield* requireCheckpoints(directory, checks);
  yield* pollProfile(claude, options.runtime);
  const shown = yield* runTurn(
    claude,
    'Continue with our work.',
    directory,
    'next-safe-turn',
    options.timeoutSeconds,
    checks,
    { kind: 'resume', id: sent.sessionId },
    {
      kind: 'require',
      outcome: {
        source: fixture.codex.name,
        kind: 'retry',
        messageIds: replyIds,
      },
    },
    sources,
  );
  const visibleResult =
    shown.transcript.visible
      .toLowerCase()
      .includes(fixture.codex.name.toLowerCase()) &&
    /\b100\b/.test(shown.transcript.visible) &&
    /\b200\b/.test(shown.transcript.visible) &&
    /success|succeed|successful/i.test(shown.transcript.visible) &&
    /open|mark[^.!?\n]*done|until[^.!?\n]*done/i.test(shown.transcript.visible);
  checks.push(
    Check.make({
      name: 'visible-result',
      status: visibleResult ? 'pass' : 'fail',
      detail:
        'The resumed owner conversation must show the retry outcome and name the actual source.',
    }),
  );
  const open = yield* captureMail(claude, marker, directory, 'presented');
  checks.push(
    checkMessageState(open, replyIds, 'presented', 'presentation-keeps-unread'),
  );
  yield* requireCheckpoints(directory, checks);
  const completed = yield* runTurn(
    claude,
    `Mark the result for ${marker} done. Leave every other item alone.`,
    directory,
    'explicit-done',
    options.timeoutSeconds,
    checks,
    { kind: 'resume', id: shown.sessionId },
    { kind: 'observe' },
    sources,
  );
  const done = yield* captureMail(claude, marker, directory, 'done');
  checks.push(checkMessageState(done, replyIds, 'done', 'explicit-completion'));
  yield* requireCheckpoints(directory, checks);
  yield* runTurn(
    codex,
    `Send one owner-authorized follow-up reply to the same ${marker} test thread for this synthetic evaluation: the separate follow-up verification returned HTTP 204 with zero retries. Copy my owner at ${fixture.codex.ownerEmail ?? ''}. Follow our installed protocol and only the dedicated pair’s addresses.`,
    directory,
    'follow-up',
    options.timeoutSeconds,
    checks,
    { kind: 'resume', id: reply.sessionId },
    { kind: 'observe' },
    sources,
  );
  const followUp = yield* captureMail(
    claude,
    marker,
    directory,
    'follow-up-received',
    (snapshot) =>
      newPeerMessages(snapshot, fixture.codex.inbox ?? '', done).length > 0,
  );
  const followUpMessages = newPeerMessages(
    followUp,
    fixture.codex.inbox ?? '',
    done,
  );
  const followUpIds = followUpMessages.map((message) => message.message_id);
  checks.push(
    checkPeerReplyDelivery(
      followUp,
      requestIds,
      fixture.codex.inbox ?? '',
      fixture.claude.inbox ?? '',
      fixture.codex.ownerEmail ?? '',
      allowedEmails,
      done,
    ),
    checkMessageState(
      followUp,
      followUpIds,
      'open',
      'follow-up-arrived-unread',
    ),
  );
  yield* requireCheckpoints(directory, checks);
  yield* pollProfile(claude, options.runtime);
  const reopened = yield* runTurn(
    claude,
    'Continue with our work.',
    directory,
    'reopened-turn',
    options.timeoutSeconds,
    checks,
    { kind: 'resume', id: completed.sessionId },
    {
      kind: 'require',
      outcome: {
        source: fixture.codex.name,
        kind: 'follow-up',
        messageIds: followUpIds,
      },
    },
    sources,
  );
  const reopenedSnapshot = yield* captureMail(
    claude,
    marker,
    directory,
    'reopened',
  );
  checks.push(
    checkMessageState(
      reopenedSnapshot,
      followUpIds,
      'presented',
      'follow-up-reopens',
    ),
    checkMessageState(
      reopenedSnapshot,
      replyIds,
      'done',
      'earlier-result-stays-done',
    ),
    Check.make({
      name: 'follow-up-visible',
      status:
        reopened.transcript.visible
          .toLowerCase()
          .includes(fixture.codex.name.toLowerCase()) &&
        /\b204\b/.test(reopened.transcript.visible)
          ? 'pass'
          : 'fail',
      detail:
        'The distinct HTTP 204 follow-up must appear visibly in the same owner conversation.',
    }),
  );
  checks.push(
    yield* checkHookObservation(claude, started),
    yield* checkHookObservation(codex, started),
  );
});

const runIteration = Effect.fn('evals.runIteration')(function* (
  options: EvaluationOptions,
  root: string,
  fixture: PairFixture,
  iteration: number,
) {
  const fs = yield* FileSystem.FileSystem;
  const directory = `${root}/evidence/${options.scenario}-${String(iteration)}-${randomUUID()}`;
  yield* fs.makeDirectory(directory, { mode: 0o700 });
  const checks: Check[] = [];
  const run =
    options.scenario === 'roundtrip'
      ? runRoundtrip(options, root, fixture, directory, checks)
      : runReadOnly(options, root, directory, checks);
  const result = yield* run.pipe(Effect.result);
  if (Result.isFailure(result)) {
    checks.push(
      Check.make({
        name: 'scenario-completion',
        status: 'blocked',
        detail:
          result.failure._tag === 'EvaluationError'
            ? result.failure.reason
            : 'A required filesystem or schema boundary failed; inspect retained native evidence.',
      }),
    );
  }
  yield* persistChecks(directory, checks);
  let status: 'pass' | 'fail' | 'blocked' = 'pass';
  if (checks.some((check) => check.status === 'blocked')) {
    status = 'blocked';
  }
  if (checks.some((check) => check.status === 'fail')) {
    status = 'fail';
  }
  yield* writeEvidence(
    `${directory}/verdict.json`,
    JSON.stringify({ status, scenario: options.scenario, iteration }, null, 2),
  );
  yield* Console.log(
    `${options.scenario} ${String(iteration)}: ${status} (${directory})`,
  );
  return status;
});

const verifyOwnedTrust = Effect.fn('evals.verifyOwnedTrust')(function* (
  root: string,
  reuseNativeAuth: boolean,
) {
  const trust = yield* trustOwnedCodexHooks(
    profileAt(root, 'codex', reuseNativeAuth),
  ).pipe(Effect.result);
  yield* writeEvidence(
    `${root}/evidence/codex-owned-hook-trust.json`,
    JSON.stringify(trust, null, 2),
  );
  if (trust._tag === 'Failure') {
    return yield* Effect.fail(trust.failure);
  }
  return Check.make({
    name: 'codex:owned-hook-trust',
    status: 'pass',
    detail:
      'A fresh native app-server verified persisted trust for enabled, exact owned hooks; disabled and unrelated hooks were preserved.',
  });
});

/** Preflight always runs; scenarios require an explicit execute flag. */
export const evaluate = Effect.fn('evals.evaluate')(function* (
  options: EvaluationOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixture = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(PairFixture),
  )(yield* fs.readFileString(options.fixture));
  const runtime = yield* fs.realPath(path.resolve(options.runtime));
  const root = yield* initializeRoot(options.root);
  if (options.prepare) {
    yield* prepareRuntime(root, runtime);
  }
  yield* verifyContainment(root);
  if (options.reuseNativeAuth) {
    yield* seedCodexAuthentication(root);
  }
  let trustCheck: Check | undefined;
  if (options.trustOwnedHooks) {
    trustCheck = yield* verifyOwnedTrust(root, options.reuseNativeAuth);
  }
  const preflight = [
    ...(trustCheck === undefined ? [] : [trustCheck]),
    ...(yield* preflightHost(root, 'claude', options.reuseNativeAuth)),
    ...(yield* preflightHost(root, 'codex', options.reuseNativeAuth)),
  ];
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    runtime,
    runtimeSha256: createHash('sha256')
      .update(yield* fs.readFile(runtime))
      .digest('hex'),
    node: process.version,
    scenario: options.scenario,
    repeats: options.repeats,
    scheduling: 'manual',
    authentication: options.reuseNativeAuth
      ? {
          claude: 'native-secure-storage',
          codex: 'private-auth-cache-snapshot',
        }
      : { claude: 'isolated-profile', codex: 'isolated-profile' },
    preflight,
  };
  yield* writeEvidence(
    `${root}/evidence/preflight.json`,
    JSON.stringify(manifest, null, 2),
  );
  yield* Console.log(JSON.stringify({ root, preflight }, null, 2));
  if (!options.execute) {
    return 'preflight';
  }
  if (
    preflight.some(
      (check) =>
        !check.name.endsWith(':hook-execution') && check.status !== 'pass',
    )
  ) {
    yield* Console.log(
      'BLOCKED: native executable, isolated auth, or installed skill prerequisite is missing. See preflight.json.',
    );
    return 'blocked';
  }
  let overall: 'pass' | 'fail' | 'blocked' = 'pass';
  for (let iteration = 1; iteration <= options.repeats; iteration++) {
    const status = yield* runIteration(
      { ...options, runtime },
      root,
      fixture,
      iteration,
    );
    if (status === 'fail' || (overall !== 'fail' && status === 'blocked')) {
      overall = status;
    }
    if (status !== 'pass' && options.scenario === 'roundtrip') {
      break;
    }
  }
  return overall;
});
