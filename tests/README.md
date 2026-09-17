# Tests

Tests follow the public modules they exercise: application workflows,
collaboration, platform services, host integration, software distribution and
upgrades, and the contributor evaluation runner. `tooling/` verifies repository
validation tools.

Run `pnpm test` for the complete suite or pass a module directory, such as
`pnpm test tests/hosts`. Vitest discovers `tests/**/*.test.ts`; moving a test
does not change whether it runs. Installation and migration tests use temporary
homes. Native model runs and real mailbox scenarios use the separate `evals/`
runner and require explicit invocation.
