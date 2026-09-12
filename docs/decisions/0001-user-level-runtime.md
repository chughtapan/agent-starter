# 0001: Use a user-level local runtime

- Status: Accepted
- Date: 2026-08-27

## Context

The earlier kit stored identity, skills, state, and machine wiring in a personal
Git clone. Users commonly work across several repositories and may use Claude,
Codex, and OpenClaw on one machine. Repo ownership fragmented one logical agent
identity and made the clone an accidental product boundary.

The interaction model still needs rapid local iteration. A hosted service would
add accounts, authorization, privacy, operations, and billing before demand and
the user interface are proven.

## Decision

Install one user-level runtime under `~/.social-harness/`. Keep identity,
roster, norms, configuration, runtime state, and logs there. Keep secrets in
provider-owned user storage. Permit optional Git export but disable it by
default.

## Rationale

A user-level runtime gives one stable collaboration identity and state across
projects and hosts while preserving the fast, inspectable local development loop
needed for internal dogfood. It removes the repo from the user journey without
committing to hosted infrastructure.

## Consequences

- Host adapters can share state without a session registry or project clone.
- Installation and migration must distinguish product source from user state.
- Machine sleep limits local continuity and must be stated honestly.
- Multi-device synchronization and always-on delivery remain unavailable.

## Alternatives considered

### Keep the repo-local kit

Rejected because identity and wiring would remain duplicated across projects,
and Claude-specific scripts would continue to define the product shape.

### Build a hosted collaboration control plane

Deferred because it expands trust, operations, and product scope before the
native-host interaction is validated.

### Use Git as canonical installed state

Rejected because ordinary users should not manage a repository to collaborate,
and runtime state, secrets, and delivery metadata do not belong in source
control.
