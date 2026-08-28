# Architecture decisions

Accepted decisions for the first product version:

- [0001: Use a user-level local runtime](0001-user-level-runtime.md)
- [0002: Keep conversation as the work surface](0002-native-conversation-and-update-board.md)
- [0003: Use AgentMail labels as canonical state](0003-agentmail-label-state.md)
- [0004: Build the runtime with Effect and TypeScript](0004-effect-typescript-runtime.md)
- [0005: Detect thin host adapters and run one local poller](0005-host-adapters-and-local-poller.md)
- [0006: Require clean, preflighted migration](0006-clean-migration.md)
- [0007: Package generated documents as templates](0007-packaged-document-templates.md)
- [0008: Use repository-local quality guards](0008-repository-quality-guards.md)

Use [the template](template.md) for new decisions. Do not create decision
lineage metadata before the first product version is complete. Update an
accepted ADR only to correct facts or clarify the original decision; record a
materially new decision in a new ADR.
