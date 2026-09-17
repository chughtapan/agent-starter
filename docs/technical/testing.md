# Testing strategy

The test strategy follows user risk, not module count. Use `@effect/vitest` for
Effect programs and Layers for shared service setups. Do not call
`Effect.runPromise` manually in ordinary tests.

The earlier 32-test baseline is documented in the
[test suite audit](../audits/test-suite-audit.md). The
[current audit](../audits/current-state-2026-09-12.md) records the expanded
regressions and remaining live gates. Do not treat component tests as proof of
native skill discovery, authentication, hook trust, or conversation visibility.

## Presubmit

`pnpm check` runs formatting, ESLint, Knip, the architecture gate, strict
TypeScript, and Vitest. `pnpm build` verifies emitted Node ESM. Run
`node dist/cli.js --help` and `node dist/upgrades/bootstrap.js --help`
afterward. The packaged-install regression compiles and installs an actual
tarball offline in a temporary home, then exercises the installed bootstrap and
templates.

## Target test layers

### Unit

- Schema and ConfigProvider accept the documented config and reject invalid
  durations.
- Board formatting preserves state, person, summary, age, and no session text.
- Host hook merge preserves unrelated settings and remains idempotent.
- Mailbox state precedence keeps triaged work unread and explicit completion
  authoritative.

### Component

- Isolate `HOME`, `SOCIAL_HARNESS_USER_HOME`, `SOCIAL_HARNESS_HOME`,
  `AGENTMAIL_HOME`, `CLAUDE_CONFIG_DIR`, and `CODEX_HOME`. Use manual scheduling
  unless a test explicitly owns a `dev.social-harness.eval.*` launchd label.
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

## Repeatable native evaluations

Use the [evaluation driver](../../evals/README.md) for preflight, isolated
preparation, real host skill discovery, generic negative prompts, and the
request/reply/present/done/reopen flow. Run each automated scenario three times.
Read the canonical message-label snapshots alongside native host transcripts;
tool output alone does not prove that the owner saw a result.

Use two authorized dedicated test inboxes and distinct owner aliases. Reuse
verified test credentials when available; signing up again with an existing
email can rotate its credential. Reserve new aliases for fresh-signup cases. Use
separately authenticated native profiles, or the explicitly authorized
`--reuse-native-auth` option described in the evaluation README. Keep candidate
skills, hooks, and mail state isolated in either mode. Complete Codex hook
review inside the disposable profile; do not bypass native trust.

The matrix in the evaluation README also tracks manual OTP recovery, interrupted
setup, outage/stale-cache behavior, host-closed delivery, sleep/wake, OpenClaw,
and published stable-release transitions. Missing evidence is a blocked or
unexecuted gate, never a pass.
