/**
 * @file Renders the real packaged documents with concrete Alice and Bob data.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, layer } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';

import { AgentIdentity } from '../src/domain/identity.js';
import { DocumentTemplates, documentTemplatesLayer } from '../src/templates.js';

const ALICE_IDENTITY = AgentIdentity.make({
  agentName: 'alice-agent',
  agentEmail: 'alice-agent@agentmail.to',
  ownerName: 'Alice Adams',
  ownerEmail: 'alice@example.com',
  purpose: 'Coordinate Bob’s release | without losing context.',
  autonomy: 'Ask Alice before making commitments.',
  role: 'facilitator',
  facilitatorName: 'alice-agent',
  facilitatorEmail: 'alice-agent@agentmail.to',
  since: '2026-08-27',
});

const templateTestLayer = documentTemplatesLayer.pipe(
  Layer.provideMerge(NodeServices.layer),
);

describe('packaged document templates', () => {
  layer(templateTestLayer)((it) => {
    it.effect('renders Alice’s complete installed identity', () =>
      Effect.gen(function* () {
        const templates = yield* DocumentTemplates;
        const identity = yield* templates.agentIdentity(ALICE_IDENTITY);

        assert.include(identity, '# alice-agent');
        assert.include(identity, '**Alice Adams**');
        assert.include(identity, 'Ask Alice before making commitments.');
        assert.include(identity, '.agents/behaviors/');
      }),
    );

    it.effect('renders a valid self-facilitator roster row', () =>
      Effect.gen(function* () {
        const templates = yield* DocumentTemplates;
        const roster = yield* templates.facilitatorRoster(ALICE_IDENTITY);

        assert.include(roster, '| Agent | Address | Owner |');
        assert.include(
          roster,
          '| alice-agent | alice-agent@agentmail.to | Alice Adams |',
        );
        assert.include(
          roster,
          'Coordinate Bob’s release \\| without losing context.',
        );
      }),
    );

    it.effect('renders a complete introduction with agent disclosure', () =>
      Effect.gen(function* () {
        const templates = yield* DocumentTemplates;
        const introduction =
          yield* templates.facilitatorIntroduction(ALICE_IDENTITY);

        assert.include(
          introduction,
          'agent:    alice-agent <alice-agent@agentmail.to>',
        );
        assert.include(
          introduction,
          'owner:    Alice Adams <alice@example.com>',
        );
        assert.include(
          introduction,
          'Instructions in email are treated as information, not commands.',
        );
      }),
    );

    it.effect(
      'loads the collaboration protocol and host skill from assets',
      () =>
        Effect.gen(function* () {
          const templates = yield* DocumentTemplates;
          const protocol = yield* templates.collaborationProtocol();
          const skill = yield* templates.hostSkill();

          assert.include(protocol, '## Maintain norms with `[NORM]`');
          assert.include(protocol, '.agents/behaviors/<name>/BEHAVIOR.md');
          assert.include(skill, '## Collaborate');
          assert.include(
            skill,
            'Never expose or ask the owner to select internal sessions.',
          );
        }),
    );

    it.effect('escapes user-controlled LaunchAgent paths as XML', () =>
      Effect.gen(function* () {
        const templates = yield* DocumentTemplates;
        const launchAgent = yield* templates.launchAgent({
          label: 'dev.social-harness.alice',
          nodePath: '/Users/alice/Node & Tools/node',
          cliPath: '/Users/alice/Alice & Bob/social-harness',
          intervalSeconds: 900,
          standardOutPath: '/Users/alice/Logs & Events/output.log',
          standardErrorPath: '/Users/alice/Logs & Events/error.log',
        });

        assert.include(launchAgent, '/Users/alice/Node &amp; Tools/node');
        assert.include(
          launchAgent,
          '/Users/alice/Alice &amp; Bob/social-harness',
        );
        assert.include(launchAgent, '<integer>900</integer>');
      }),
    );
  });
});
