# Runtime source

This directory contains the host-neutral Social Harness runtime. Each top-level
TypeScript file owns one capability, such as the mailbox, update board,
onboarding, or scheduling. `layers.ts` assembles those capabilities, and
`cli.ts` is the process boundary.

Current data contracts live in `domain/`. Packaged user-facing documents live in
`templates/`, outside this directory. All support for earlier installations,
including detection and conversion, stays in `migration.ts`.
