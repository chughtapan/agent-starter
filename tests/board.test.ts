/**
 * @file Verifies the compact, session-free collaboration board contract.
 */

import { assert, describe, it } from '@effect/vitest';

import { renderBoard } from '../src/board.js';
import { CollaborationUpdate } from '../src/domain/collaboration.js';

describe('update board', () => {
  it('shows collaboration state without sessions', () => {
    const now = Date.parse('2026-08-27T18:00:00.000Z');
    const output = renderBoard(
      [
        CollaborationUpdate.make({
          threadId: 'thread-1',
          messageId: 'message-1',
          kind: 'needsYou',
          collaborator: 'Alice <alice@example.com>',
          summary: 'dataset-access decision',
          updatedAt: '2026-08-27T17:59:00.000Z',
          labels: ['sh-needs-you', 'unread'],
          unread: true,
          subject: 'Dataset access',
        }),
        CollaborationUpdate.make({
          threadId: 'thread-2',
          messageId: 'message-2',
          kind: 'waiting',
          collaborator: 'carol@example.com',
          summary: 'API example',
          updatedAt: '2026-08-27T17:28:00.000Z',
          labels: ['sh-waiting'],
          unread: false,
          subject: 'API example',
        }),
      ],
      now,
    );

    assert.include(output, 'NEEDS YOU Alice · dataset-access decision');
    assert.include(output, 'WAITING   carol · API example · 32m');
    assert.notInclude(output.toLowerCase(), 'session');
  });

  it('has an explicit empty state', () => {
    assert.strictEqual(renderBoard([], 0), 'UPDATES\nALL CLEAR');
  });

  it('uses the inbox name when the transport display name is generic', () => {
    const output = renderBoard(
      [
        CollaborationUpdate.make({
          threadId: 'thread-intro',
          messageId: 'message-intro',
          kind: 'ready',
          collaborator: 'AgentMail <bob-agent@agentmail.to>',
          summary: 'Welcome, alice-agent.',
          updatedAt: '2026-08-27T18:00:00.000Z',
          labels: ['sh-ready', 'unread'],
          unread: true,
          subject: 'Re: [INTRO] alice-agent for Alice Adams',
        }),
      ],
      Date.parse('2026-08-27T18:01:00.000Z'),
    );

    assert.include(output, 'READY     bob-agent · Welcome, alice-agent.');
  });
});
