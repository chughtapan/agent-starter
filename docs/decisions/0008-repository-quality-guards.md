# 0008: Use repository-local quality guards

- Status: Accepted
- Date: 2026-08-27

## Context

Social Harness is being migrated from a shell-oriented prototype into a small
Effect and TypeScript product. Several coding agents and human reviewers may
edit it from different host environments. Readability, dependency drift, unowned
architecture boundaries, and incomplete tests need fast, consistent feedback
without requiring a particular editor or global installation.

The checks must remain reproducible from the lockfile, usable in CI, and fast
enough for repeated agent review. Tool findings can also be wrong, so every
exception needs an inspectable reason and narrow scope.

## Decision

Pin Agent Code Guard and Safer Architecture as development dependencies. Run
Agent Code Guard with ESLint and Knip, and run Safer Architecture as a separate
whole-project gate. Include both in `pnpm check` with formatting, strict
TypeScript, and Vitest.

Cache ESLint under `node_modules/.cache/`. Keep architecture allowances in the
schema-validated `safer-architecture.config.json`, with a concrete reason for
each entry. Keep rule-specific bug workarounds in `eslint.config.js`, limited to
the affected file and linked to the upstream report.

## Rationale

Repository-local versions give agents, contributors, editors, and CI one source
of truth. Agent Code Guard turns readability, Effect, test, security, and dead
code expectations into immediate feedback. Safer Architecture checks
relationships across files and makes deliberate boundaries reviewable. Caching
keeps this feedback in the normal edit loop.

Reasoned exceptions preserve judgment. They document why the current shape is
intentional without normalizing blanket suppression.

## Consequences

- `pnpm check` fails on lint, dead code, architecture, type, format, or test
  findings.
- Contributors do not need a global quality tool or editor extension.
- Tool upgrades are ordinary reviewed dependency changes with lockfile updates.
- False positives require a narrow workaround, a reason, and an upstream issue
  when the problem is reproducible.
- The checks add local runtime cost; content-addressed caches keep repeat runs
  short.

## Alternatives considered

### Use ESLint and TypeScript alone

Rejected because they do not detect the Effect-specific readability and
whole-project boundary problems found during this migration.

### Require global tools or one editor plugin

Rejected because host-specific installation would make results differ across
Claude, Codex, OpenClaw, contributors, and CI.

### Run the deeper checks only in CI

Rejected because late feedback slows iteration and makes diagnostics less
actionable for the authoring agent.

### Disable noisy rules broadly

Rejected because a blanket exception hides valid findings in application code.
The current upstream bug affects only the Vitest configuration wrapper, so the
workaround remains limited to that file.
