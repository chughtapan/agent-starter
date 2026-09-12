# Contributing

## Development standard

Use the smallest clear change that improves the approved experience contract.
Apply Google TypeScript and documentation guidance. In particular:

- use Effect services and Layers at boundaries;
- decode configuration, persisted data, and external responses with Schema;
- use Config and ConfigProvider for configuration sources;
- use Effect CLI, platform filesystem, path, HTTP, process, terminal, and
  standard-output services instead of parallel abstractions;
- model expected failures as typed errors;
- preserve existing host configuration and remove only owned entries; and
- keep user-facing copy outcome-first and free of implementation vocabulary.

Keep the following boundaries explicit:

- Put all compatibility formats, old identifiers, conversion rules, and cleanup
  behavior in `src/migration.ts`. Runtime services may expose neutral operations
  that migration calls, but they must not know earlier product formats.
- Put installed instructions, agent prompts, outbound message bodies, and
  generated configuration documents in `templates/`. Use Nunjucks variables; do
  not embed long instruction strings in TypeScript.
- Use Alice, Bob, and Carol in examples and tests. Do not use contributor,
  teammate, or customer identities as sample data.

Do not add Python. The only shell script is the required Effect source prepare
step. Do not add a second poller, database, session picker, dashboard
application, or application-specific norm to the runtime.

## Before review

Run:

```sh
pnpm check
pnpm build
node dist/cli.js --help
```

Tests must be deterministic and hermetic at their declared size. Name tests for
observable behavior, assert state or output instead of implementation calls, and
use real local collaborators such as Schema, ConfigProvider, Nunjucks, and the
filesystem when they are fast and reliable. Use Effect test Layers for shared
services; do not call `Effect.runPromise` in ordinary tests.

See the [test suite audit](docs/audits/test-suite-audit.md) for current coverage
and release-blocking gaps. See [code quality](docs/technical/code-quality.md)
for the local LSP, cache, and narrow upstream-workaround policy.

The lint and architecture checks keep content-addressed reports under
`node_modules/.cache/`. The cache is disposable and excluded from Git; repeated
agent checks reuse it automatically.

Update the PRD, user stories, experience contract, technical reference, or ADR
when a change alters the product boundary or a durable decision. ADRs include
context, decision, rationale, consequences, and alternatives with explicit
rejection reasons.

Review migrations for exact ownership and destructive scope. A migration must
inspect first, block on unrelated or uncommitted data, copy and verify before
cleanup, and never delete product source.
