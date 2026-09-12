/**
 * @file Verifies additive host-hook installation and ownership detection.
 */

import { assert, describe, it } from '@effect/vitest';

import { addSessionHook, hasSessionHook } from '../src/adapters.js';

describe('host hook merge', () => {
  it('preserves existing hooks and settings', () => {
    const existing = {
      model: 'configured-model',
      hooks: {
        SessionStart: [
          { hooks: [{ type: 'command', command: 'orca-hook', timeout: 10 }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'timeline-hook' }] }],
      },
    };
    const updated = addSessionHook(existing);
    const encoded = JSON.stringify(updated);

    assert.strictEqual(updated.model, 'configured-model');
    assert.include(encoded, 'orca-hook');
    assert.include(encoded, 'timeline-hook');
    assert.include(encoded, 'social-harness updates --if-needed');
    assert.isTrue(hasSessionHook(updated));
  });

  it('is idempotent', () => {
    const once = addSessionHook({});
    assert.deepEqual(addSessionHook(once), once);
  });

  it('does not report an absent hook as installed', () => {
    assert.isFalse(hasSessionHook(undefined));
    assert.isFalse(hasSessionHook({ hooks: {} }));
  });
});
