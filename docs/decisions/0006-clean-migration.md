# 0006: Require clean, preflighted migration

- Status: Accepted
- Date: 2026-08-27

## Context

The old repo-local kit can leave identity files, skills, hooks, MCP wiring,
poller state, labels, and a personal clone. Running old and new systems together
would cause duplicate processing and make failures impossible to interpret. User
clones may also contain unrelated or uncommitted work that the product does not
own.

## Decision

Migration is copy-first and all-or-blocked. Inspect the exact source, Git state,
known artifacts, and unrelated files before mutation. Migrate canonical user
data, install and verify the new runtime, remove only old product-owned wiring,
and delete a dedicated clean clone only after explicit authorization. Never
delete product source.

## Rationale

A clean cutover produces one understandable system and supports meaningful
dogfood failure traces. Preflight and exact ownership protect user data while
still honoring the requirement not to leave junk behind.

## Consequences

- Dirty or mixed-purpose clones require user cleanup or an explicit manual
  migration.
- Migration code must preserve other tools’ hook entries and host settings.
- Destructive targets must be resolved paths with a recorded plan.
- Rollback after source deletion depends on the migrated copy and Git remote;
  live verification therefore occurs first.

## Alternatives considered

### Leave the old clone and wiring unread

Rejected because old hooks and pollers still execute even if users ignore the
files, producing duplicate behavior and operational ambiguity.

### Delete all legacy-looking configuration automatically

Rejected because host config may contain unrelated tools, and a personal clone
may contain user work.

### Maintain both systems during an extended compatibility window

Rejected for the first product version because lineage and dual-write logic
would slow learning and make failures harder to attribute.
