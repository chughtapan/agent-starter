/**
 * @file Resolves user-level product, host, and credential paths from Config.
 */

import * as Config from 'effect/Config';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';

/** Provides every user-owned path used by the local runtime. */
export interface HarnessPaths {
  readonly home: string;
  readonly agentmailHome: string;
  readonly userHome: string;
  readonly claudeHome: string;
  readonly codexHome: string;
  readonly agentsHome: string;
  readonly openClawHome: string;
  readonly agent: string;
  readonly norms: string;
  readonly runtime: string;
  readonly state: string;
  readonly logs: string;
  readonly config: string;
  readonly identity: string;
  readonly identityData: string;
  readonly protocol: string;
  readonly roster: string;
  readonly status: string;
  readonly events: string;
  readonly cache: string;
  readonly presentation: string;
  readonly onboarding: string;
  readonly ownership: string;
  readonly migration: string;
  readonly pollLock: string;
  readonly agentmailKey: string;
  readonly agentmailInbox: string;
  readonly agentmailPendingOtp: string;
}

/** Identifies the local Social Harness path service. */
export class Paths extends Context.Service<Paths, HarnessPaths>()(
  'social-harness/Paths',
) {}

/** Builds all local paths from process environment values. */
export const pathsLayer = Layer.effect(Paths)(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const userHome = yield* Config.string('HOME');
    const configuredHome = yield* Config.option(
      Config.string('SOCIAL_HARNESS_HOME'),
    );
    const configuredAgentmailHome = yield* Config.option(
      Config.string('AGENTMAIL_HOME'),
    );
    const home = Option.getOrElse(configuredHome, () =>
      path.join(userHome, '.social-harness'),
    );
    const agentmailHome = Option.getOrElse(configuredAgentmailHome, () =>
      path.join(userHome, '.agentmail'),
    );
    const agent = path.join(home, 'agent');
    const state = path.join(home, 'state');
    const logs = path.join(home, 'logs');

    return {
      home,
      agentmailHome,
      userHome,
      claudeHome: path.join(userHome, '.claude'),
      codexHome: path.join(userHome, '.codex'),
      agentsHome: path.join(userHome, '.agents'),
      openClawHome: path.join(userHome, '.openclaw'),
      agent,
      norms: path.join(agent, '.agents', 'behaviors'),
      runtime: path.join(home, 'runtime'),
      state,
      logs,
      config: path.join(home, 'config.json'),
      identity: path.join(agent, 'AGENTS.md'),
      identityData: path.join(state, 'identity.json'),
      protocol: path.join(agent, 'PROTOCOL.md'),
      roster: path.join(agent, 'roster.md'),
      status: path.join(agent, 'status.md'),
      events: path.join(logs, 'events.jsonl'),
      cache: path.join(state, 'mailbox-cache.json'),
      presentation: path.join(state, 'presentation.json'),
      onboarding: path.join(state, 'onboarding.json'),
      ownership: path.join(state, 'ownership.json'),
      migration: path.join(state, 'migration.json'),
      pollLock: path.join(state, 'poll.lock'),
      agentmailKey: path.join(agentmailHome, 'key'),
      agentmailInbox: path.join(agentmailHome, 'inbox'),
      agentmailPendingOtp: path.join(agentmailHome, 'pending-otp'),
    };
  }).pipe(Effect.withSpan('pathsLayer')),
);
