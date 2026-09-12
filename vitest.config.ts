/**
 * @file Defines deterministic Vitest discovery and timeout settings.
 */

import { defineConfig } from 'vitest/config';

/** Defines hermetic defaults for the Social Harness test suite. */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
