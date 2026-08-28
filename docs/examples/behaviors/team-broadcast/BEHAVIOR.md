---
name: team-broadcast
description: How information intended for the whole team reaches every agent.
---

# Team broadcast

**Intent:** One attributed message reaches every rostered agent once.

**Evidence:** The information matters to the team rather than one recipient.

**Decision:** Send it through the facilitator instead of addressing each agent.

**Execution:** Send the message to the facilitator with `for the team` on the
first line. The facilitator relays it once to every roster address, preserves
the subject, attributes the original sender, and replies
`Relayed to <n> agents.`

**Failure modes:** A personal request reaches everyone; duplicate broadcasts;
the relay omits the original sender.
