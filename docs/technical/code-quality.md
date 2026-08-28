# Code quality

The repository uses one local command for review feedback:

```sh
pnpm check
```

It runs formatting, Agent Code Guard and Knip, Safer Architecture, strict
TypeScript, and Vitest. `pnpm build` remains a separate emitted-package gate.

## Repository-local tools

`package.json` pins Agent Code Guard and Safer Architecture so contributors and
CI use the same versions. Do not require a global editor plugin. Editors that
support a repository-local stdio language server can run:

```sh
pnpm exec safer-architecture-lsp serve
```

`safer-architecture.config.json` records the small set of deliberate
architecture boundaries and the reason for each one. Fix a finding in the code
when possible. Add an allowance only when the design is intentional and its
reason will still help a future reviewer.

## Effect runtime alignment

All Effect runtime packages and `@effect/vitest` use the same exact prerelease.
The direct `@effect/platform-node-shared` dependency is intentional: npm can
otherwise satisfy the platform package's prerelease range with a newer,
incompatible Effect runtime. The package-contract test keeps these versions
aligned and verifies that the published CLI and template assets remain listed.

## Cached feedback

ESLint uses a content-addressed cache at
`node_modules/.cache/eslint/.eslintcache`. Safer Architecture also caches its
analysis. Both locations are disposable, ignored through `node_modules/`, and
safe to reuse across agent sessions.

## Agent Code Guard 0.0.21 workaround

Agent Code Guard 0.0.21 can stop making progress when two or more of three
declaration-walk rules inspect Vitest's documented default-exported
`defineConfig` wrapper. The reproduction and pairwise isolation are recorded in
[Agent Code Guard issue 108](https://github.com/chughtapan/agent-code-guard/issues/108#issuecomment-5447567444).

`eslint.config.js` disables only those three rules for `vitest.config.ts`:

- `no-vacuous-jsdoc`
- `prefer-stepdown-function-order`
- `require-stable-file-shell`

Application source keeps all three rules enabled. Remove the workaround after an
upstream release fixes the reproduction.

## Review expectations

Treat diagnostics as review findings, not formatting noise. Check correctness,
design, complexity, tests, naming, comments, and documentation together. A
change is ready when it improves repository health and all required checks pass;
it does not need speculative abstraction or unrelated polish.
