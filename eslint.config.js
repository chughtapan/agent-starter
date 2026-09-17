import { plugin as guard } from 'eslint-plugin-agent-code-guard';

const repositoryRules = {
  '@typescript-eslint/array-type': [
    'error',
    { default: 'array-simple', readonly: 'array-simple' },
  ],
  '@typescript-eslint/consistent-type-exports': 'error',
  '@typescript-eslint/consistent-type-imports': 'error',
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unsafe-type-assertion': 'error',
  '@typescript-eslint/prefer-readonly': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error',
  'no-restricted-syntax': [
    'error',
    {
      selector: 'ExportDefaultDeclaration',
      message: 'Use named exports.',
    },
    {
      selector: 'TSModuleDeclaration',
      message: 'Use ES modules, not TypeScript namespaces.',
    },
  ],
};

// Effect uses PascalCase values for schemas and Layers, and pairs schema values
// with inferred types under one name. See agent-code-guard issue #99.
const effectRules = {
  '@typescript-eslint/naming-convention': [
    'error',
    {
      selector: 'variable',
      format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
    },
    { selector: 'typeLike', format: ['PascalCase'] },
  ],
  '@typescript-eslint/no-invalid-void-type': [
    'error',
    { allowInGenericTypeArguments: true },
  ],
  '@typescript-eslint/no-redeclare': 'off',
  'agent-code-guard/no-exported-brand-constructor': 'off',
};

export default [
  {
    ignores: [
      '.repos/**',
      '.evals-build/**',
      'coverage/**',
      'dist/**',
      'eslint.config.js',
      'node_modules/**',
    ],
  },
  {
    files: ['src/**/*.ts', 'evals/**/*.ts'],
    ...guard.configs.recommended,
    rules: {
      ...guard.configs.recommended.rules,
      ...repositoryRules,
      ...effectRules,
    },
  },
  {
    files: ['tests/**/*.ts'],
    ...guard.configs.recommended,
    rules: {
      ...guard.configs.recommended.rules,
      ...repositoryRules,
      // Golden and regression assertions keep expected values near the setup,
      // following Google's DAMP test guidance.
      'agent-code-guard/no-hardcoded-assertion-literals': 'off',
      'agent-code-guard/no-test-skip-only': 'error',
      'agent-code-guard/no-example-only-tests': [
        'error',
        {
          propertyCallNames: [
            'fc.property',
            'fc.asyncProperty',
            'it.prop',
            'test.prop',
            'it.effect.prop',
          ],
        },
      ],
    },
  },
  {
    files: [
      'tests/platform/config.test.ts',
      'tests/upgrades/distribution.test.ts',
      'tests/platform/templates.test.ts',
      'tests/platform/paths.test.ts',
      'tests/hosts/scheduler.test.ts',
      'tests/application/migration-flow.test.ts',
      'tests/collaboration/presentation.test.ts',
      'tests/collaboration/mailbox-http.test.ts',
      // These commissioning regressions exercise transport and checkpoint
      // ordering; fixed traces are the relevant oracle, not generated inputs.
      'tests/application/onboarding-flow.test.ts',
      'tests/tooling/architecture-tool.test.ts',
    ],
    rules: {
      // Effect's layered test wrapper is not recognized as a test container by
      // these syntax-only rules; both files execute real Effect tests.
      'agent-code-guard/no-example-only-tests': 'off',
      'sonarjs/no-empty-test-file': 'off',
    },
  },
  {
    files: ['vitest.config.ts'],
    ...guard.configs.recommended,
    rules: {
      ...guard.configs.recommended.rules,
      ...repositoryRules,
      'import-x/no-default-export': 'off',
      // Version 0.0.21 can loop while the three declaration-walk rules inspect
      // defineConfig's exported wrapper. The application source keeps them on.
      'agent-code-guard/no-vacuous-jsdoc': 'off',
      'agent-code-guard/prefer-stepdown-function-order': 'off',
      'agent-code-guard/require-stable-file-shell': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSModuleDeclaration',
          message: 'Use ES modules, not TypeScript namespaces.',
        },
      ],
    },
  },
];
