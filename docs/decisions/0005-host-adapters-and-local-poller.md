# 0005: Detect thin host adapters and run one local poller

- Status: Accepted
- Date: 2026-08-27

## Context

Users may have Claude, Codex, OpenClaw, or several at once. They expect to start
or resume existing conversations. Installing a poller or state store for every
host would duplicate work and create contradictory updates. Cloud schedulers
exist but have different semantics and are not yet proven for this product.

## Decision

Automatically detect supported hosts during onboarding, migration, upgrade, and
diagnosis. Install a thin skill and start/resume presentation hook only for
compatible detected hosts, preserving non-owned configuration. Run one
host-neutral local poller; on macOS, one launchd routine invokes it while the
machine is awake.

## Rationale

Thin adapters keep user interaction native while centralizing state and
continuity. One poller makes behavior predictable for users with several hosts
and avoids choosing or exposing sessions. Local scheduling is sufficient to test
the experience before cloud complexity is introduced.

## Consequences

- A user may close a host but must keep the Mac awake for checks.
- OpenClaw receives the shared skill in v0.4; its native background scheduler
  remains a later adapter.
- Non-macOS installations report a manual scheduler requirement.
- Cloud routines cannot be used in delivery promises yet.

## Alternatives considered

### Install one poller per host

Rejected because several installed hosts would multiply requests, cache writes,
notifications, and failure states.

### Ask the user to select a session

Rejected because sessions are routing infrastructure, not a useful product
concept, and users commonly have many open sessions.

### Use modelines or status lines as the primary interface

Rejected because capabilities differ by host, narrow surfaces can be skipped,
and the board is for updates rather than substantive work.

### Implement cloud routines immediately

Deferred because provider permissions, revocation, delivery, and wake semantics
would slow interaction learning and create promises the first release cannot
verify.
