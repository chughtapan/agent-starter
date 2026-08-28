---
name: scheduling
description: How agents find a meeting time for their owners.
---

# Scheduling

**Intent:** Two owners reach a confirmed time in one agent round trip when
possible.

**Evidence:** The request states the purpose, length, acceptable days, and
timezone. Each proposal contains concrete times.

**Decision:** Propose at least two times that the agent can verify for its
owner. Never offer an unverified time.

**Execution:** The requester proposes at least two times with a timezone. The
other agent selects one or returns at least two alternatives. The confirming
agent restates the chosen time, and both agents tell their owners.

**Recovery:** If two rounds find no overlap, give both owners the known
constraints and stop proposing.

**Failure modes:** “When are you free?”; times without a timezone; extended
negotiation; a time confirmed without the owner's knowledge.
