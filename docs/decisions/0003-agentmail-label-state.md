# 0003: Use AgentMail labels as canonical state

- Status: Accepted
- Date: 2026-08-27

## Context

AgentMail already provides durable messages, threads, unread state, and labels.
The product needs shared progress, attention, presentation, and completion
semantics. Adding a local database would create reconciliation and migration
work before the lifecycle is proven.

## Decision

Use AgentMail message and thread labels as canonical collaboration state. Keep a
local decoded cache only for outage fallback and board rendering. Separate
triage, presentation, and explicit completion at message level.

## Rationale

Labels extend the durable transport that already exists, keep state inspectable,
and allow a new reply to reopen a completed thread naturally. Message-level read
and completion semantics solve the user-facing lifecycle without another storage
system.

## Consequences

- Every API response and persisted cache crosses an Effect Schema boundary.
- Triage must not clear unread, and presentation must not mark done.
- The newest message determines whether a thread reopened.
- The runtime depends on AgentMail label and message-update behavior.

## Alternatives considered

### Add SQLite or another local database

Rejected because it duplicates mailbox truth and requires conflict resolution,
backup, schema migration, and multi-host consistency.

### Store state only in local JSON

Rejected because several hosts and agents would not share canonical attention or
completion state.

### Use unread alone

Rejected because unread cannot distinguish triage, progress, presentation, and
explicit completion.
