/**
 * @file Defines shared nonsecret contracts for real host evaluations.
 */

import * as Schema from 'effect/Schema';

/** Hosts whose native transcripts the evaluator understands. */
export const Host = Schema.Literals(['claude', 'codex']);
/** A supported native host name. */
export type Host = typeof Host.Type;

/** Declared isolated test identity; credentials stay in its AgentMail home. */
export class TestIdentity extends Schema.Class<TestIdentity>('TestIdentity')({
  name: Schema.String.check(Schema.isMinLength(1)),
  ownerEmail: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/)),
  ),
  inbox: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/)),
  ),
}) {}

/** Pair declarations are reviewed before any scenario can send test mail. */
export class PairFixture extends Schema.Class<PairFixture>('PairFixture')({
  schemaVersion: Schema.Literal(1),
  dedicatedTestIdentities: Schema.Boolean,
  claude: TestIdentity,
  codex: TestIdentity,
}) {}

/** Marks directories created by this runner without storing credentials. */
export class IsolationMarker extends Schema.Class<IsolationMarker>(
  'IsolationMarker',
)({
  schemaVersion: Schema.Literal(1),
  purpose: Schema.Literal('social-harness-real-host-evals'),
}) {}

/** A safe failure message that cannot contain raw provider responses. */
export class EvaluationError extends Schema.TaggedErrorClass<EvaluationError>()(
  'EvaluationError',
  {
    operation: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.reason}`;
  }
}

/** Distinguishes missing prerequisites from observed behavior failures. */
export class Check extends Schema.Class<Check>('Check')({
  name: Schema.String,
  status: Schema.Literals(['pass', 'fail', 'blocked']),
  detail: Schema.String,
}) {}

/** Scenarios run explicitly; only roundtrip is permitted to send mail. */
const Scenario = Schema.Literals([
  'skill-discovery',
  'generic-negative',
  'roundtrip',
]);
/** A declared executable scenario name. */
type Scenario = typeof Scenario.Type;

/** Validated invocation values supplied by the Effect CLI. */
export interface EvaluationOptions {
  readonly root: string;
  readonly fixture: string;
  readonly runtime: string;
  readonly prepare: boolean;
  readonly execute: boolean;
  readonly reuseNativeAuth: boolean;
  readonly trustOwnedHooks: boolean;
  readonly scenario: Scenario;
  readonly repeats: number;
  readonly timeoutSeconds: number;
}

/** Fixed directories prevent a fixture from targeting installed user state. */
export interface Profile {
  readonly host: Host;
  readonly home: string;
  readonly native: string;
  readonly workspace: string;
  readonly harness: string;
  readonly agentmail: string;
  readonly reuseNativeAuth: boolean;
}

/** Process output is redacted before persistence and never logged directly. */
export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

/** Decoded host evidence separates visible text from tool and hook events. */
export interface Transcript {
  readonly sessionIds: readonly string[];
  readonly visible: string;
  readonly toolCalls: readonly string[];
  readonly successfulToolCalls: readonly string[];
  readonly hookEvents: readonly string[];
  readonly malformedLines: number;
  readonly nativeErrors: readonly string[];
}

/** Canonical message metadata used to distinguish delivery from model claims. */
export interface MailSnapshot {
  readonly threads: ReadonlyArray<{
    readonly thread_id: string;
    readonly labels: readonly string[];
    readonly messages: ReadonlyArray<{
      readonly message_id: string;
      readonly labels: readonly string[];
      readonly sender: string;
      readonly recipients: readonly string[];
    }>;
  }>;
}
