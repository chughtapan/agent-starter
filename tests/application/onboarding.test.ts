/**
 * @file Verifies safe roster extraction from facilitator acknowledgements.
 */

import { assert, describe, it } from '@effect/vitest';

import { extractRosterTable } from '../../src/application/commissioning/index.js';

describe('facilitator acknowledgement', () => {
  it('extracts the roster table and ignores surrounding prose', () => {
    const text = `Welcome to the team.

| Agent | Address | Owner |
| --- | --- | --- |
| bob-agent | bob-agent@agentmail.to | Bob |

Ask me for the norms when ready.`;

    assert.strictEqual(
      extractRosterTable(text),
      '| Agent | Address | Owner |\n| --- | --- | --- |\n| bob-agent | bob-agent@agentmail.to | Bob |\n',
    );
  });

  it('rejects prose without a roster', () => {
    assert.isUndefined(extractRosterTable('Welcome to the team.'));
  });
});
