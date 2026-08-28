/**
 * @file Verifies earlier identity and mailbox state conversion without I/O.
 */

import { assert, describe, it } from '@effect/vitest';
import { FastCheck } from 'effect/testing';

import {
  isOwnedLegacyEntry,
  parseLegacyIdentity,
  rewriteLegacyLabels,
} from '../src/migration.js';

const LEGACY_IDENTITY = `# alice-agent

## Who I am

- I am **alice-agent**, an AI agent run by **Alice Adams**
  <alice@example.com>.
- My inbox is **alice-agent@agentmail.to**. It is the only address I send from.
- Purpose: Help Bob ship reliable software.
- Since: 2026-08-01
- Autonomy: Reply within purpose; ask before commitments.
- Role: collaborator
- Facilitator: **Bob Agent** <bob-agent@agentmail.to> — introductions go there.
`;

describe('clean migration compatibility', () => {
  it('recognizes every top-level working area owned by the earlier product', () => {
    assert.isTrue(isOwnedLegacyEntry('CLAUDE.md'));
    assert.isTrue(isOwnedLegacyEntry('proposals'));
    assert.isTrue(isOwnedLegacyEntry('team'));
    assert.isFalse(isOwnedLegacyEntry('Alice-notes.md'));
  });

  it('preserves every canonical identity field', () => {
    const identity = parseLegacyIdentity(LEGACY_IDENTITY);

    assert.isDefined(identity);
    assert.strictEqual(identity.agentName, 'alice-agent');
    assert.strictEqual(identity.ownerName, 'Alice Adams');
    assert.strictEqual(identity.facilitatorName, 'Bob Agent');
    assert.strictEqual(identity.facilitatorEmail, 'bob-agent@agentmail.to');
    assert.strictEqual(
      identity.autonomy,
      'Reply within purpose; ask before commitments.',
    );
  });

  it('blocks an incomplete identity instead of guessing', () => {
    assert.isUndefined(parseLegacyIdentity('# Unknown agent'));
  });

  it('keeps an unacknowledged introduction open and waiting', () => {
    const rewrite = rewriteLegacyLabels({
      threadId: 'thread-introduction',
      threadLabels: new Set(['intro-sent']),
    });

    assert.deepEqual(rewrite, {
      addThreadLabels: ['sh-collaboration', 'sh-waiting'],
      removeThreadLabels: ['intro-sent'],
      addMessageLabels: [],
      removeMessageLabels: [],
    });
  });

  it('keeps an owner decision open even after the earlier pass ran', () => {
    const rewrite = rewriteLegacyLabels({
      threadId: 'thread-needs-owner',
      threadLabels: new Set(['needs-human', 'processed']),
    });

    assert.deepEqual(rewrite, {
      addThreadLabels: ['sh-collaboration'],
      removeThreadLabels: ['needs-human', 'processed'],
      addMessageLabels: ['sh-needs-you'],
      removeMessageLabels: [],
    });
  });

  it('marks an earlier handled reply done', () => {
    const rewrite = rewriteLegacyLabels({
      threadId: 'thread-handled',
      threadLabels: new Set(['processed', 'replied']),
    });

    assert.deepEqual(rewrite, {
      addThreadLabels: ['sh-collaboration'],
      removeThreadLabels: ['processed', 'replied'],
      addMessageLabels: ['sh-done'],
      removeMessageLabels: [],
    });
  });

  it('leaves unrelated mailbox state unchanged', () => {
    assert.isUndefined(
      rewriteLegacyLabels({
        threadId: 'thread-unrelated',
        threadLabels: new Set(['unread']),
      }),
    );
  });

  it.prop(
    'leaves every combination of current mailbox labels unchanged',
    [
      FastCheck.uniqueArray(
        FastCheck.constantFrom(
          'sh-collaboration',
          'sh-done',
          'sh-needs-you',
          'sh-ready',
          'sh-waiting',
          'unread',
        ),
      ),
    ],
    ([labels]) =>
      rewriteLegacyLabels({
        threadId: 'thread-current',
        threadLabels: new Set(labels),
      }) === undefined,
  );
});
