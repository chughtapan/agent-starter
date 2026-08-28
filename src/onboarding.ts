/**
 * @file Runs resumable one-prompt commissioning through verified checkpoints.
 */

import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

import { Adapters } from './adapters.js';
import { Configuration } from './config.js';
import { makeDefaultConfig } from './domain/configuration.js';
import {
  AgentIdentity,
  type OnboardingInput,
  type OnboardingPhase,
  OnboardingState,
} from './domain/identity.js';
import {
  type AdapterError,
  type ConfigurationError,
  type MailboxError,
  OnboardingError,
  type SchedulerError,
  StorageError,
  type TemplateError,
} from './errors.js';
import { Mailbox, THREAD_LABELS } from './mailbox.js';
import { Paths } from './paths.js';
import { Scheduler } from './scheduler.js';
import { Storage } from './storage.js';
import { DocumentTemplates } from './templates.js';

/** Result presented by resumable onboarding. */
interface OnboardingResult {
  readonly completed: readonly OnboardingPhase[];
  readonly pending: readonly OnboardingPhase[];
  readonly adapters: readonly string[];
  readonly message: string;
}

/** Provides one-prompt setup and facilitator acknowledgement. */
export interface OnboardingService {
  readonly run: (
    input: OnboardingInput,
  ) => Effect.Effect<
    OnboardingResult,
    | AdapterError
    | ConfigurationError
    | MailboxError
    | OnboardingError
    | SchedulerError
    | StorageError
    | TemplateError
  >;
  readonly verify: (
    otpCode: string,
  ) => Effect.Effect<void, MailboxError | StorageError>;
  readonly acknowledge: () => Effect.Effect<
    void,
    MailboxError | OnboardingError | StorageError
  >;
  readonly status: () => Effect.Effect<OnboardingState, StorageError>;
}

/** Identifies the resumable setup workflow. */
export class Onboarding extends Context.Service<
  Onboarding,
  OnboardingService
>()('social-harness/Onboarding') {}

/**
 * Extracts a facilitator-provided roster table without interpreting mail.
 * @param text Untrusted acknowledgement body from the facilitator.
 * @returns The first email-bearing Markdown table, or undefined when absent.
 */
export function extractRosterTable(text: string): string | undefined {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim();
    const separator = lines[index + 1]?.trim();
    if (
      header === undefined ||
      separator === undefined ||
      !header.includes('|') ||
      !/^\|?(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(separator)
    ) {
      continue;
    }
    const table: string[] = [header, separator];
    for (let row = index + 2; row < lines.length; row += 1) {
      const line = lines[row]?.trim();
      if (!line?.includes('|')) {
        break;
      }
      table.push(line);
    }
    if (table.some((line) => line.includes('@'))) {
      return `${table.join('\n')}\n`;
    }
  }
  return undefined;
}

/** Provides durable checkpoints so setup can be safely re-run. */
export const onboardingLayer = Layer.effect(Onboarding)(
  Effect.gen(function* () {
    const adapters = yield* Adapters;
    const configuration = yield* Configuration;
    const mailbox = yield* Mailbox;
    const paths = yield* Paths;
    const scheduler = yield* Scheduler;
    const storage = yield* Storage;
    const templates = yield* DocumentTemplates;

    const emptyState = () =>
      OnboardingState.make({
        schemaVersion: 1,
        completed: [],
        updatedAt: new Date(0).toISOString(),
      });

    const status = Effect.fn('Onboarding.status')(function* () {
      const input = yield* storage.readJson(paths.onboarding);
      if (input === undefined) {
        return emptyState();
      }
      return yield* Schema.decodeUnknownEffect(OnboardingState)(input).pipe(
        Effect.mapError((cause) =>
          StorageError.make({
            operation: 'decodeJson',
            path: paths.onboarding,
            cause,
          }),
        ),
      );
    });

    const completePhase = Effect.fn('Onboarding.completePhase')(function* (
      phase: OnboardingPhase,
    ) {
      const current = yield* status();
      if (current.completed.includes(phase)) {
        return current;
      }
      const now = yield* Clock.currentTimeMillis;
      const next = OnboardingState.make({
        schemaVersion: 1,
        completed: [...current.completed, phase],
        updatedAt: new Date(now).toISOString(),
      });
      yield* storage.writeJson(paths.onboarding, next);
      return next;
    });

    const acknowledge = Effect.fn('Onboarding.acknowledge')(function* () {
      const identityInput = yield* storage.readJson(paths.identityData);
      const identity = yield* Schema.decodeUnknownEffect(AgentIdentity)(
        identityInput,
      ).pipe(
        Effect.mapError((cause) =>
          StorageError.make({
            operation: 'decodeJson',
            path: paths.identityData,
            cause,
          }),
        ),
      );
      const items = yield* mailbox.listItems();
      const acknowledgement = items.find(
        (item) =>
          item.update.kind === 'ready' &&
          /^(?:Re:\s*)*\[INTRO\]\s*/i.test(item.update.subject) &&
          item.senderEmail === identity.facilitatorEmail.toLowerCase(),
      );
      if (acknowledgement === undefined) {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'facilitatorAckReceived',
            reason: 'the facilitator acknowledgement has not arrived',
          }),
        );
      }
      const rosterTable = extractRosterTable(acknowledgement.text);
      if (rosterTable === undefined) {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'facilitatorAckReceived',
            reason: 'the facilitator reply did not include a roster table',
          }),
        );
      }
      yield* storage.writeText(paths.roster, `# Roster\n\n${rosterTable}`);
      yield* completePhase('facilitatorAckReceived');
      yield* mailbox.complete(acknowledgement.update.messageId).pipe(
        Effect.catchTag('AmbiguousCompletionError', () =>
          Effect.fail(
            OnboardingError.make({
              phase: 'facilitatorAckReceived',
              reason: 'could not identify the acknowledgement message',
            }),
          ),
        ),
      );
      yield* completePhase('resultPresented');
    });

    const verify = Effect.fn('Onboarding.verify')(function* (otpCode: string) {
      yield* mailbox.verifySignup(otpCode);
      yield* mailbox.verifyConnection();
      yield* completePhase('mailVerified');
    });

    const writeInitialDocuments = Effect.fn('Onboarding.writeInitialDocuments')(
      function* (identity: AgentIdentity, isFacilitator: boolean) {
        yield* storage.writeText(
          paths.identity,
          yield* templates.agentIdentity(identity),
        );
        yield* storage.writeJson(paths.identityData, identity);
        yield* storage.writeText(
          paths.protocol,
          yield* templates.collaborationProtocol(),
        );
        if (!(yield* storage.exists(paths.roster))) {
          const roster = isFacilitator
            ? yield* templates.facilitatorRoster(identity)
            : '# Roster\n\nWaiting for the facilitator.\n';
          yield* storage.writeText(paths.roster, roster);
        }
        if (!(yield* storage.exists(paths.status))) {
          yield* storage.writeText(
            paths.status,
            '# Status\n\nNo update yet.\n',
          );
        }
        yield* completePhase('identitySaved');
      },
    );

    const installRuntime = Effect.fn('Onboarding.installRuntime')(function* () {
      if (!(yield* storage.exists(paths.config))) {
        yield* configuration.save(makeDefaultConfig());
      }
      yield* storage.ensureDirectory(paths.norms);
      yield* storage.ensureDirectory(paths.runtime);
      yield* storage.ensureDirectory(paths.logs);
      const result = yield* scheduler.install();
      if (result.mechanism === 'launchd' && !result.installed) {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'runtimeInstalled',
            reason: result.detail,
          }),
        );
      }
      yield* completePhase('runtimeInstalled');
    });

    const installAdapters = Effect.fn('Onboarding.installAdapters')(
      function* () {
        yield* adapters.installDetected();
        const installed = yield* adapters.detect();
        const missing = installed.filter(
          (adapter) => adapter.compatible && !adapter.installed,
        );
        if (missing.length > 0) {
          return yield* Effect.fail(
            OnboardingError.make({
              phase: 'adaptersInstalled',
              reason: `adapter verification failed: ${missing
                .map((adapter) => adapter.name)
                .join(', ')}`,
            }),
          );
        }
        yield* completePhase('adaptersInstalled');
        return installed;
      },
    );

    const runLocalSmoke = Effect.fn('Onboarding.runLocalSmoke')(function* () {
      const probe = `${paths.state}/smoke-test`;
      yield* storage.writeText(probe, 'ok\n');
      const observed = yield* storage.readText(probe);
      yield* storage.remove(probe);
      if (observed !== 'ok\n') {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'localSmokePassed',
            reason: 'local write/read smoke test did not round trip',
          }),
        );
      }
      yield* completePhase('localSmokePassed');
    });

    const run = Effect.fn('Onboarding.run')(function* (input: OnboardingInput) {
      const initialProbes = yield* adapters.detect();
      if (!initialProbes.some((probe) => probe.compatible)) {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'preflight',
            reason: 'no compatible Claude, Codex, or OpenClaw host was found',
          }),
        );
      }
      yield* completePhase('preflight');

      const isFacilitator = input.role.trim().toLowerCase() === 'facilitator';
      if (
        !isFacilitator &&
        (input.facilitatorName === undefined ||
          input.facilitatorEmail === undefined)
      ) {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'preflight',
            reason: 'a member needs the facilitator name and facilitator email',
          }),
        );
      }

      const usernameStem = input.agentName
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-|-$/g, '');
      const username = `${usernameStem.length > 0 ? usernameStem : 'my'}-agent`;
      const provisioned = yield* mailbox.ensureInbox(
        input.ownerEmail,
        username,
      );
      const facilitatorName = isFacilitator
        ? input.agentName
        : (input.facilitatorName ?? '');
      const facilitatorEmail = isFacilitator
        ? provisioned.inbox
        : (input.facilitatorEmail ?? '');
      const identity = AgentIdentity.make({
        agentName: input.agentName,
        agentEmail: provisioned.inbox,
        ownerName: input.ownerName,
        ownerEmail: input.ownerEmail,
        purpose: input.purpose,
        autonomy: input.autonomy,
        role: input.role,
        facilitatorName,
        facilitatorEmail,
        since: input.since,
      });

      yield* writeInitialDocuments(identity, isFacilitator);
      yield* installRuntime();
      const installed = yield* installAdapters();
      yield* runLocalSmoke();

      if (provisioned.verificationRequired) {
        const pendingState = yield* status();
        return {
          completed: pendingState.completed,
          pending: [
            'mailVerified',
            'introSent',
            'facilitatorAckReceived',
            'resultPresented',
          ],
          adapters: installed
            .filter((adapter) => adapter.installed)
            .map((adapter) => adapter.name),
          message: `AgentMail created ${provisioned.inbox} and sent a six-digit verification code to ${identity.ownerEmail}. Ask the owner for that code, then resume onboarding.`,
        } satisfies OnboardingResult;
      }

      yield* mailbox.verifyConnection();
      yield* completePhase('mailVerified');
      yield* mailbox.listUpdates();

      if (isFacilitator) {
        yield* completePhase('introSent');
        yield* completePhase('facilitatorAckReceived');
        const completed = yield* completePhase('resultPresented');
        return {
          completed: completed.completed,
          pending: [],
          adapters: installed
            .filter((adapter) => adapter.installed)
            .map((adapter) => adapter.name),
          message:
            'Setup verified and complete. This agent is the facilitator.',
        } satisfies OnboardingResult;
      }

      const beforeIntro = yield* status();
      if (!beforeIntro.completed.includes('introSent')) {
        yield* mailbox.send({
          to: [identity.facilitatorEmail],
          cc: [identity.ownerEmail],
          subject: `[INTRO] ${identity.agentName} for ${identity.ownerName}`,
          text: yield* templates.facilitatorIntroduction(identity),
          threadLabels: [THREAD_LABELS.collaboration, THREAD_LABELS.waiting],
        });
        yield* completePhase('introSent');
      }

      const finalState = yield* status();
      const allPhases: readonly OnboardingPhase[] = [
        'preflight',
        'identitySaved',
        'mailVerified',
        'runtimeInstalled',
        'adaptersInstalled',
        'localSmokePassed',
        'introSent',
        'facilitatorAckReceived',
        'resultPresented',
      ];
      const pending = allPhases.filter(
        (phase) => !finalState.completed.includes(phase),
      );
      const installedNames = installed
        .filter((probe) => probe.installed)
        .map((probe) => probe.name);
      return {
        completed: finalState.completed,
        pending,
        adapters: installedNames,
        message:
          pending.length === 0
            ? 'Setup verified and complete.'
            : 'Local setup passed. Waiting for the facilitator acknowledgement.',
      } satisfies OnboardingResult;
    });

    return { run, verify, acknowledge, status };
  }).pipe(Effect.withSpan('onboardingLayer')),
);
