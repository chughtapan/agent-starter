# Test suite audit

Date: 2026-08-27

The current suite is fast, deterministic, and readable, but it does not yet
prove that onboarding and clean migration work on an installed machine. Those
gaps are release work, not evidence that the existing 32 tests are weak.

## Current shape

| Size and scope    | Count | Share | What it covers                                                               |
| ----------------- | ----: | ----: | ---------------------------------------------------------------------------- |
| Small, narrow     |    27 |   84% | Configuration, package contract, labels, hooks, board output, and conversion |
| Medium, component |     5 |   16% | Real packaged templates through Effect Layers and the local filesystem       |
| Large, end to end |     0 |    0% | None yet                                                                     |

This distribution is close to the Google 80/15/5 heuristic. The missing large
slice is intentional during implementation, but it must exist before an external
pilot.

## What is working

- Every test is hermetic at its declared size. There is no live network, sleep,
  shared mailbox, or order dependency.
- Tests use public operations and assert returned state or rendered output. They
  do not assert private call sequences.
- Names describe behavior. Setup and expected values stay together, following
  DAMP test style.
- Effect tests use `@effect/vitest`; the template suite shares a real
  `DocumentTemplates` Layer instead of building ad hoc runtimes.
- Property tests cover the two invariants most likely to cause silent workflow
  regressions: completed messages never reopen, and current labels are never
  treated as earlier labels.
- Mailbox chronology ignores label-edit timestamps, so an earlier outbound
  message cannot displace a later reply on the update board.
- Template tests render the actual packaged assets with Alice and Bob data,
  including Markdown table and XML escaping.
- The public package contract pins one Effect runtime across npm dependency
  resolution and includes the CLI and template assets.

## Release-blocking gaps

Before internal dogfood:

1. Automate the packaged-install smoke test now run manually. Install the
   tarball in a temporary directory, run the built CLI, and prove templates
   resolve outside the source tree.
2. Add filesystem component tests for resumable onboarding. Cover a first run,
   OTP pause, rerun, and the rule that the facilitator introduction is sent
   once.
3. Add clean-migration component tests with disposable clean, dirty, unknown,
   and product-source fixtures. Prove that copy and verification precede exact
   source removal.

Before the external pilot:

1. Add a faithful fake AgentMail HTTP boundary. Cover pagination, malformed
   JSON, transport failure, label updates, send, and reply, then run the same
   contract against the live service as a separate smoke test.
2. Add child-process component tests for host detection and launchd status,
   install failure, and verification.
3. Complete one live onboarding and collaboration round trip in Claude, Codex,
   and OpenClaw. Record every failure trace as a regression test at the smallest
   reliable size.

## Review standard

New tests must fail for the behavior they claim to protect. Prefer real local
implementations over mocks when they are fast and deterministic. Keep live
machine checks out of presubmit, give them an explicit owner, and make failure
output name the failed checkpoint and recovery action.
