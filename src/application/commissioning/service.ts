/**
 * @file Runs resumable one-prompt commissioning through verified checkpoints.
 */

import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

import {
  Mailbox,
  type MailboxError,
  THREAD_LABELS,
} from '../../collaboration/mail/index.js';
import {
  type PresentationError,
  Receipts,
} from '../../collaboration/presentation/index.js';
import { makeDefaultConfig } from '../../domain/configuration.js';
import {
  AgentIdentity,
  HostObservation,
  type OnboardingInput,
  type OnboardingPhase,
  OnboardingState,
} from '../../domain/identity.js';
import {
  type AdapterError,
  Adapters,
  Scheduler,
  type SchedulerError,
} from '../../hosts/index.js';
import {
  Configuration,
  type ConfigurationError,
} from '../../platform/configuration/index.js';
import {
  DocumentTemplates,
  type TemplateError,
} from '../../platform/documents/index.js';
import {
  Paths,
  Storage,
  StorageError,
} from '../../platform/persistence/index.js';

/** Onboarding cannot advance until the reported condition changes. */
class OnboardingError extends Schema.TaggedErrorClass<OnboardingError>()(
  'OnboardingError',
  {
    phase: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.phase}: ${this.reason}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}

/** Result presented by resumable onboarding. */
interface OnboardingResult {
  readonly completed: readonly OnboardingPhase[];
  readonly pending: readonly OnboardingPhase[];
  readonly adapters: readonly string[];
  readonly message: string;
}

/** A concrete host or the legacy latest-native-observation lookup. */
type HostVerificationTarget = 'claude' | 'codex' | 'native' | 'openClaw';

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
    | PresentationError
    | SchedulerError
    | StorageError
    | TemplateError
  >;
  readonly verify: (
    otpCode: string,
  ) => Effect.Effect<void, MailboxError | StorageError>;
  readonly acknowledge: () => Effect.Effect<
    void,
    | ConfigurationError
    | MailboxError
    | OnboardingError
    | StorageError
    | PresentationError
  >;
  readonly status: () => Effect.Effect<OnboardingState, StorageError>;
  readonly retryIntroduction: () => Effect.Effect<
    void,
    StorageError | OnboardingError
  >;
  readonly verifyHost: (
    host?: HostVerificationTarget,
  ) => Effect.Effect<
    void,
    StorageError | OnboardingError | ConfigurationError | PresentationError
  >;
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
    const receipts = yield* Receipts;

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
        Effect.mapError(() =>
          StorageError.make({
            operation: 'decodeJson',
            path: paths.onboarding,
          }),
        ),
      );
    });

    const updateState = Effect.fn('Onboarding.updateState')(function* (
      changes: Partial<typeof OnboardingState.Encoded>,
    ) {
      const current = yield* Schema.encodeEffect(OnboardingState)(
        yield* status(),
      ).pipe(
        Effect.mapError(() =>
          StorageError.make({
            operation: 'encodeOnboarding',
            path: paths.onboarding,
          }),
        ),
      );
      const next = OnboardingState.make({
        ...current,
        ...changes,
        updatedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
      });
      yield* storage.writeJson(paths.onboarding, next);
      return next;
    });

    const completePhase = Effect.fn('Onboarding.completePhase')(function* (
      phase: OnboardingPhase,
    ) {
      const current = yield* status();
      if (current.completed.includes(phase)) {
        return current;
      }
      return yield* updateState({ completed: [...current.completed, phase] });
    });

    const inspectHostProof = Effect.fn('Onboarding.inspectHostProof')(
      function* (
        host: HostVerificationTarget,
        requireLaterPresentation: boolean,
      ) {
        let observedAt: string;
        let visibleHost: 'claude' | 'codex' | 'openClaw' | undefined;
        if (host === 'openClaw') {
          const installed = (yield* adapters.detect()).some(
            (probe) =>
              probe.name === 'openClaw' && probe.compatible && probe.installed,
          );
          if (!installed) {
            return yield* Effect.fail(
              OnboardingError.make({
                phase: 'hostVerified',
                reason: 'OpenClaw skill installation has not been verified',
              }),
            );
          }
          observedAt = (yield* status()).updatedAt;
          visibleHost = 'openClaw';
        } else {
          const observationPath =
            host === 'native'
              ? `${paths.state}/host-observation.json`
              : `${paths.state}/host-observation-${host}.json`;
          const observation = yield* Schema.decodeUnknownEffect(
            HostObservation,
          )(yield* storage.readJson(observationPath)).pipe(
            Effect.mapError(() =>
              OnboardingError.make({
                phase: 'hostVerified',
                reason: `valid ${host} hook evidence was not found; resume that host and review hook trust if required`,
              }),
            ),
          );
          if (host !== 'native' && observation.host !== host) {
            return yield* Effect.fail(
              OnboardingError.make({
                phase: 'hostVerified',
                reason: `the recorded hook did not originate from ${host}`,
              }),
            );
          }
          observedAt = observation.observedAt;
          visibleHost = observation.host;
        }
        if (visibleHost === undefined) {
          return yield* Effect.fail(
            OnboardingError.make({
              phase: 'hostVerified',
              reason:
                'resume Claude or Codex with explicit host hooks to establish host-specific presentation proof',
            }),
          );
        }
        const visible = yield* receipts.read(visibleHost);
        if (
          visible === undefined ||
          (host !== 'openClaw' && visible.nativeConfirmed !== true) ||
          !Number.isFinite(Date.parse(visible.lastPresentedAt)) ||
          !Number.isFinite(Date.parse(observedAt)) ||
          (host === 'openClaw' &&
            requireLaterPresentation &&
            Date.parse(visible.lastPresentedAt) < Date.parse(observedAt))
        ) {
          return yield* Effect.fail(
            OnboardingError.make({
              phase: 'hostVerified',
              reason: `show the board in ${visibleHost} and wait for host-confirmed presentation before resuming setup`,
            }),
          );
        }
        return visibleHost;
      },
    );

    const requireVerifiedHost = Effect.fn('Onboarding.requireVerifiedHost')(
      function* (checkpoint: OnboardingState) {
        const host = checkpoint.verifiedHost;
        if (
          !checkpoint.completed.includes('hostVerified') ||
          host === undefined ||
          host === 'native'
        ) {
          return yield* Effect.fail(
            OnboardingError.make({
              phase: 'hostVerified',
              reason:
                'resume the host and run onboard host-verified with explicit --host claude, codex, or openClaw before finishing setup',
            }),
          );
        }
        // OpenClaw's original receipt can precede later setup checkpoints.
        // Revalidate its proof without making each checkpoint require new output.
        return yield* inspectHostProof(host, false);
      },
    );

    const acknowledge = Effect.fn('Onboarding.acknowledge')(function* () {
      const checkpoint = yield* status();
      if (checkpoint.completed.includes('resultPresented')) {
        return;
      }
      const verifiedHost = yield* requireVerifiedHost(checkpoint);
      const identityInput = yield* storage.readJson(paths.identityData);
      const identity = yield* Schema.decodeUnknownEffect(AgentIdentity)(
        identityInput,
      ).pipe(
        Effect.mapError(() =>
          StorageError.make({
            operation: 'decodeJson',
            path: paths.identityData,
          }),
        ),
      );
      const items = yield* mailbox.listItems();
      const acknowledgement = items.find(
        (item) =>
          item.update.kind === 'ready' &&
          /^(?:Re:\s*)*\[INTRO\]\s*/i.test(item.update.subject) &&
          (checkpoint.introThreadId === undefined
            ? item.update.subject.replace(/^(?:Re:\s*)*/i, '') ===
              `[INTRO] ${identity.agentName} for ${identity.ownerName}`
            : item.update.threadId === checkpoint.introThreadId) &&
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
      const visibility = yield* receipts.read(verifiedHost);
      if (
        !visibility?.visibleMessageIds?.includes(
          acknowledgement.update.messageId,
        )
      ) {
        return yield* Effect.fail(
          OnboardingError.make({
            phase: 'resultPresented',
            reason:
              'present the facilitator reply and acknowledge its visibility receipt first',
          }),
        );
      }
      yield* storage.writeText(paths.roster, `# Roster\n\n${rosterTable}`);
      yield* completePhase('facilitatorAckReceived');
      yield* completePhase('resultPresented');
    });

    const verifyHost = Effect.fn('Onboarding.verifyHost')(function* (
      host: HostVerificationTarget = 'native',
    ) {
      const verifiedHost = yield* inspectHostProof(host, true);
      yield* updateState({ verifiedHost });
      yield* completePhase('hostVerified');
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

    const sendIntroduction = Effect.fn('Onboarding.sendIntroduction')(
      function* (identity: AgentIdentity) {
        const beforeIntro = yield* status();
        if (!beforeIntro.completed.includes('introSent')) {
          // The send result was persisted before the final phase checkpoint.
          // A restart in that narrow interval must finish the checkpoint, never
          // infer that the facilitator reply authorizes another introduction.
          if (beforeIntro.introThreadId !== undefined) {
            yield* completePhase('introSent');
            return;
          }
          const subject = `[INTRO] ${identity.agentName} for ${identity.ownerName}`;
          const previous = (yield* mailbox.listItems()).find(
            (item) =>
              item.update.subject.replace(/^(?:Re:\s*)*/i, '') === subject &&
              item.senderEmail === identity.agentEmail.toLowerCase(),
          );
          if (
            beforeIntro.introductionPending === true &&
            previous === undefined
          ) {
            return yield* Effect.fail(
              OnboardingError.make({
                phase: 'introSent',
                reason:
                  'introduction delivery is uncertain; inspect sent mail before explicitly retrying',
              }),
            );
          }
          yield* updateState({ introductionPending: true });
          const introduction =
            previous === undefined
              ? yield* mailbox.send({
                  to: [identity.facilitatorEmail],
                  cc: [identity.ownerEmail],
                  subject,
                  text: yield* templates.facilitatorIntroduction(identity),
                  threadLabels: [
                    THREAD_LABELS.collaboration,
                    THREAD_LABELS.waiting,
                  ],
                })
              : { threadId: previous.update.threadId };
          yield* updateState({
            introductionPending: false,
            introThreadId: introduction.threadId,
          });
          yield* completePhase('introSent');
        }
      },
    );

    const retryIntroduction = Effect.fn('Onboarding.retryIntroduction')(
      function* () {
        const current = yield* status();
        if (
          current.introductionPending !== true ||
          current.completed.includes('introSent')
        ) {
          return yield* Effect.fail(
            OnboardingError.make({
              phase: 'introSent',
              reason: 'there is no uncertain introduction to retry',
            }),
          );
        }
        yield* updateState({ introductionPending: false });
      },
    );

    const validateIdentityInput = Effect.fn('Onboarding.validateIdentityInput')(
      function* (input: OnboardingInput) {
        const persisted = yield* storage.readJson(paths.identityData);
        if (persisted === undefined) {
          return;
        }
        const identity = yield* Schema.decodeUnknownEffect(AgentIdentity)(
          persisted,
        ).pipe(
          Effect.mapError(() =>
            StorageError.make({
              operation: 'decodeIdentity',
              path: paths.identityData,
            }),
          ),
        );
        const fields = [
          'agentName',
          'ownerName',
          'ownerEmail',
          'purpose',
          'autonomy',
          'role',
          'since',
        ] as const;
        const differs =
          fields.some((field) => input[field] !== identity[field]) ||
          (input.facilitatorEmail !== undefined &&
            input.facilitatorEmail !== identity.facilitatorEmail) ||
          (input.facilitatorName !== undefined &&
            input.facilitatorName !== identity.facilitatorName);
        if (differs) {
          return yield* Effect.fail(
            OnboardingError.make({
              phase: 'identitySaved',
              reason:
                'setup already belongs to a different identity or authority contract; resume with the original inputs or use a separate home',
            }),
          );
        }
      },
    );

    const run = Effect.fn('Onboarding.run')(function* (input: OnboardingInput) {
      yield* validateIdentityInput(input);
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
      const installedNames = installed
        .filter((probe) => probe.compatible && probe.installed)
        .map((probe) => probe.name);
      yield* runLocalSmoke();

      if (provisioned.verificationRequired) {
        const pendingState = yield* status();
        return {
          completed: pendingState.completed,
          pending: [
            'mailVerified',
            'hostVerified',
            'introSent',
            'facilitatorAckReceived',
            'resultPresented',
          ],
          adapters: installedNames,
          message: `AgentMail created ${provisioned.inbox} and sent a six-digit verification code to ${identity.ownerEmail}. Ask the owner for that code, then resume onboarding.`,
        } satisfies OnboardingResult;
      }

      yield* mailbox.verifyConnection();
      yield* completePhase('mailVerified');
      yield* mailbox.listUpdates();

      if (isFacilitator) {
        yield* completePhase('introSent');
        yield* completePhase('facilitatorAckReceived');
        const observed = yield* status();
        if (
          !observed.completed.includes('resultPresented') &&
          !observed.completed.includes('hostVerified')
        ) {
          return {
            completed: observed.completed,
            pending: ['hostVerified', 'resultPresented'],
            adapters: installedNames,
            message:
              'Local setup passed. Resume this host, verify visible updates, then finish commissioning.',
          } satisfies OnboardingResult;
        }
        if (!observed.completed.includes('resultPresented')) {
          yield* requireVerifiedHost(observed);
        }
        const completed = yield* completePhase('resultPresented');
        return {
          completed: completed.completed,
          pending: [],
          adapters: installedNames,
          message:
            'Setup verified and complete. This agent is the facilitator.',
        } satisfies OnboardingResult;
      }

      yield* sendIntroduction(identity);
      const finalState = yield* status();
      const allPhases: readonly OnboardingPhase[] = [
        'preflight',
        'identitySaved',
        'mailVerified',
        'runtimeInstalled',
        'adaptersInstalled',
        'localSmokePassed',
        'hostVerified',
        'introSent',
        'facilitatorAckReceived',
        'resultPresented',
      ];
      const pending = allPhases.filter(
        (phase) => !finalState.completed.includes(phase),
      );
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

    return { run, verify, acknowledge, status, verifyHost, retryIntroduction };
  }).pipe(Effect.withSpan('onboardingLayer')),
);
