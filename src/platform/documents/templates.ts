/**
 * @file Loads and renders packaged Nunjucks documents through an Effect service.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import { fileURLToPath } from 'node:url';
import nunjucks from 'nunjucks';

import type { AgentIdentity } from '../../domain/identity.js';
import { TemplateError } from './errors.js';

/** Values used to render the macOS poller LaunchAgent. */
export interface LaunchAgentTemplateInput {
  readonly label: string;
  readonly nodePath: string;
  readonly cliPath: string;
  readonly intervalSeconds: number;
  readonly standardOutPath: string;
  readonly standardErrorPath: string;
  readonly environment?: Readonly<Record<string, string>>;
}

/** Provides all installed instructions and user-facing document templates. */
export interface DocumentTemplatesService {
  readonly agentIdentity: (
    identity: AgentIdentity,
  ) => Effect.Effect<string, TemplateError>;
  readonly collaborationProtocol: () => Effect.Effect<string, TemplateError>;
  readonly hostSkill: () => Effect.Effect<string, TemplateError>;
  readonly hostHook: () => Effect.Effect<string, TemplateError>;
  readonly facilitatorIntroduction: (
    identity: AgentIdentity,
  ) => Effect.Effect<string, TemplateError>;
  readonly facilitatorRoster: (
    identity: AgentIdentity,
  ) => Effect.Effect<string, TemplateError>;
  readonly launchAgent: (
    input: LaunchAgentTemplateInput,
  ) => Effect.Effect<string, TemplateError>;
}

/** Identifies the packaged Nunjucks document templates. */
export class DocumentTemplates extends Context.Service<
  DocumentTemplates,
  DocumentTemplatesService
>()('social-harness/DocumentTemplates') {}

function templatePath(name: string): string {
  return fileURLToPath(new URL(`../../../templates/${name}`, import.meta.url));
}

function rosterContext(identity: AgentIdentity): Record<string, string> {
  return Object.fromEntries(
    Object.entries(identityContext(identity)).map(([key, value]) => [
      key,
      value.replaceAll('|', '\\|').replaceAll(/\s+/g, ' ').trim(),
    ]),
  );
}

function identityContext(identity: AgentIdentity): Record<string, string> {
  return {
    agentName: identity.agentName,
    agentEmail: identity.agentEmail,
    ownerName: identity.ownerName,
    ownerEmail: identity.ownerEmail,
    purpose: identity.purpose,
    autonomy: identity.autonomy,
    role: identity.role,
    facilitatorName: identity.facilitatorName,
    facilitatorEmail: identity.facilitatorEmail,
    since: identity.since,
  };
}

/** Loads packaged templates through Effect and renders them with Nunjucks. */
export const documentTemplatesLayer = Layer.effect(DocumentTemplates)(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const environment = new nunjucks.Environment(null, {
      autoescape: false,
      throwOnUndefined: true,
    });

    const render = Effect.fn('DocumentTemplates.render')(function* (
      name: string,
      context: object,
    ) {
      const path = templatePath(name);
      const source = yield* fileSystem
        .readFileString(path)
        .pipe(Effect.mapError(() => TemplateError.make({ template: name })));
      return yield* Effect.try({
        try: () => environment.renderString(source, context),
        catch: () => TemplateError.make({ template: name }),
      });
    });

    return {
      agentIdentity: (identity: AgentIdentity) =>
        render('agent/AGENTS.md.njk', identityContext(identity)),
      collaborationProtocol: () => render('agent/PROTOCOL.md.njk', {}),
      hostSkill: () => render('agent/social-harness.SKILL.md.njk', {}),
      hostHook: () => render('agent/hook-context.txt.njk', {}),
      facilitatorIntroduction: (identity: AgentIdentity) =>
        render('onboarding/introduction.txt.njk', identityContext(identity)),
      facilitatorRoster: (identity: AgentIdentity) =>
        render('onboarding/roster.md.njk', rosterContext(identity)),
      launchAgent: (input: LaunchAgentTemplateInput) =>
        render('scheduler/launch-agent.plist.njk', {
          label: input.label,
          nodePath: input.nodePath,
          cliPath: input.cliPath,
          intervalSeconds: input.intervalSeconds,
          standardOutPath: input.standardOutPath,
          standardErrorPath: input.standardErrorPath,
          environment: input.environment ?? {},
        }),
    };
  }).pipe(Effect.withSpan('documentTemplatesLayer')),
);
