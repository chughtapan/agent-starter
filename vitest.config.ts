/**
 * @file Defines deterministic Vitest discovery and timeout settings.
 */

import { defineConfig } from 'vitest/config';

/** Defines hermetic defaults for the Social Harness test suite. */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Bound process fan-out so filesystem properties keep their timeout budget.
    maxWorkers: 2,
    testTimeout: 10_000,
  },
});
