/**
 * @file Defines agent identity and resumable onboarding state.
 */

import * as Schema from 'effect/Schema';

/** Identity and collaboration boundaries supplied during one-prompt setup. */
export class AgentIdentity extends Schema.Class<AgentIdentity>('AgentIdentity')(
  {
    agentName: Schema.String.check(Schema.isMinLength(1)),
    agentEmail: Schema.String.check(Schema.isMinLength(3)),
    ownerName: Schema.String.check(Schema.isMinLength(1)),
    ownerEmail: Schema.String.check(Schema.isMinLength(3)),
    purpose: Schema.String.check(Schema.isMinLength(1)),
    autonomy: Schema.String.check(Schema.isMinLength(1)),
    role: Schema.String.check(Schema.isMinLength(1)),
    facilitatorName: Schema.String.check(Schema.isMinLength(1)),
    facilitatorEmail: Schema.String.check(Schema.isMinLength(3)),
    since: Schema.String.check(Schema.isMinLength(8)),
  },
) {}

/** Identity facts gathered before onboarding provisions the agent inbox. */
export class OnboardingInput extends Schema.Class<OnboardingInput>(
  'OnboardingInput',
)({
  agentName: Schema.String.check(Schema.isMinLength(1)),
  ownerName: Schema.String.check(Schema.isMinLength(1)),
  ownerEmail: Schema.String.check(Schema.isMinLength(3)),
  purpose: Schema.String.check(Schema.isMinLength(1)),
  autonomy: Schema.String.check(Schema.isMinLength(1)),
  role: Schema.String.check(Schema.isMinLength(1)),
  facilitatorName: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)),
  ),
  facilitatorEmail: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(3)),
  ),
  since: Schema.String.check(Schema.isMinLength(8)),
}) {}

/** Names the durable onboarding phases in execution order. */
export const OnboardingPhase = Schema.Literals([
  'preflight',
  'identitySaved',
  'mailVerified',
  'runtimeInstalled',
  'adaptersInstalled',
  'localSmokePassed',
  'introSent',
  'facilitatorAckReceived',
  'resultPresented',
]);

/** A decoded onboarding phase name. */
export type OnboardingPhase = typeof OnboardingPhase.Type;

/** Stores resumable progress for one-prompt onboarding. */
export class OnboardingState extends Schema.Class<OnboardingState>(
  'OnboardingState',
)({
  schemaVersion: Schema.Literal(1),
  completed: Schema.Array(OnboardingPhase),
  updatedAt: Schema.String,
  failureTrace: Schema.optionalKey(Schema.String),
}) {}
