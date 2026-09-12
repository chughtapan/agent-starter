# Changelog

This file records user-visible changes to Social Harness.

## [0.4.0] - 2026-08-28

### Added

- Set up Social Harness from one prompt in Claude, Codex, or OpenClaw.
- Keep collaboration in the active conversation with a compact update board,
  explicit completion, and named-person activation.
- Detect supported agent hosts and install additive skills and session hooks.
- Create and verify an AgentMail inbox, resume onboarding by checkpoint, and
  wait for a facilitator acknowledgement before reporting completion.
- Check for updates in the background while the Mac is awake.
- Store identity, roster, norms, configuration, and runtime state under a
  private user-level Social Harness directory.

### Changed

- Rebuilt the runtime in TypeScript with Effect services, schemas,
  configuration, scheduling, platform I/O, CLI commands, and tests.
- Moved installed instructions, messages, and configuration documents into
  validated Nunjucks templates.
- Reorganized product requirements, user stories, walkthroughs, technical
  references, test audits, and architecture decisions as maintained product
  documentation.
- Licensed Social Harness under Apache License 2.0.

### Fixed

- Order mailbox messages by delivery time so later label updates cannot hide a
  newer reply.
- Show the inbox name when AgentMail supplies only a generic display name.

### Removed

- Removed the repository-local shell toolkit, host-specific poller, MCP wiring,
  and duplicate installed documentation.
- Replaced dirty in-place legacy upgrades with a preflighted, all-or-blocked
  migration that preserves current data and removes only an approved clone.
