# TODOS

## Live acceptance

### Complete the deferred live acceptance matrix

**What:** Execute and retain evidence for the real-host acceptance cases in
[GitHub issue #2](https://github.com/chughtapan/agent-starter/issues/2).

**Why:** Hermetic coverage and three isolated Claude--Codex roundtrips do not
prove fresh signup, failure recovery, OpenClaw, or a published update on real
hosts.

**Context:** Start with the acceptance matrix in `evals/README.md`. Record a
pass or a defect for each case without exposing credentials or mail content.

**Effort:** XL **Priority:** P1 **Depends on:** A published stable release for
the update and rollback case.

## Codex integration

### Integrate persisted Codex hook trust into normal setup and upgrades

**What:** Design and implement normal product trust provisioning for Codex.

**Why:** The current trust provisioning is restricted to isolated contributor
evaluations and does not make normal setup or upgrades ready for this flow.

**Context:** This is explicitly deferred in
[GitHub issue #2](https://github.com/chughtapan/agent-starter/issues/2). Do not
begin implementation without an accepted product change and ADR.

**Effort:** L **Priority:** P2 **Depends on:** Accepted product change and ADR.

## Completed
