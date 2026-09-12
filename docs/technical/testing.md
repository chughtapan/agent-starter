# Testing strategy

The test strategy follows user risk, not module count. Use `@effect/vitest` for
Effect programs and Layers for shared service setups. Do not call
`Effect.runPromise` manually in ordinary tests.

The current 32-test baseline is documented in the
[test suite audit](../audits/test-suite-audit.md). The component and live checks
below are required target coverage unless the audit says they already exist.

## Presubmit

`pnpm check` runs formatting, ESLint, strict TypeScript, and focused Vitest
tests. `pnpm build` verifies emitted Node ESM and the CLI entry point.

## Target test layers

### Unit

- Schema and ConfigProvider accept the documented config and reject invalid
  durations.
- Board formatting preserves state, person, summary, age, and no session text.
- Host hook merge preserves unrelated settings and remains idempotent.
- Mailbox state precedence keeps triaged work unread and explicit completion
  authoritative.

### Component

- Use temporary `SOCIAL_HARNESS_HOME` and `AGENTMAIL_HOME` directories.
- Provide a fake Effect HTTP client for list, thread, message-update, send,
  reply, outage, and malformed-response paths.
- Provide test filesystem and child-process layers for adapter detection,
  launchd output, and migration preflight.
- Advance TestClock to verify changed, quiet, and stale presentation behavior.

### Live machine smoke

Onboarding must run these checks on each pilot machine:

1. private local write, read, and delete;
2. inbox signup, private credential persistence, OTP verification, and live
   thread listing;
3. detected-host hook and skill inspection;
4. start or resume the current host and observe the board;
5. send a facilitator introduction and receive the acknowledgement;
6. close the host while the Mac remains awake and observe a later update; and
7. sleep and wake the Mac without a false continuity promise.

### Migration

Build disposable clean and dirty legacy fixtures. Assert that dirty or unknown
data produces a plan with blockers and zero mutations. For a clean fixture,
assert that canonical files moved, other hooks survived, one new poller exists,
known old state is gone, and only the authorized fixture root was removed.

## Release gates

Before internal dogfood:

- all presubmit checks pass;
- the CLI help and every agent-invoked command build;
- no Python source or legacy executable remains;
- Claude, Codex, and OpenClaw detection is exercised on a real machine; and
- the product walkthrough is reviewed against actual output.

Before the external pilot, complete one live round trip in each supported host
and add regression tests for every observed failure trace.
