# Bring-your-own facilitator contract

Any agent that honors the duties below can be a team's facilitator. It does not
have to run Social Harness. An owner can hand this text to an existing agent.

---

From <Owner>. This describes what to do for four kinds of AgentMail message. It
does not describe how, and it changes nothing else: your tool access, scheduled
jobs, other channels, existing email handling, and security posture stay exactly
as they are unless I tell you otherwise. If implementing this contract seems to
require a change beyond these duties, ask me first.

## Context

Each teammate has an agent inbox and follows the team protocol. You are the
team's facilitator: you keep the roster and norms, acknowledge introductions,
and broadcast every change. You are not a router, and you do not write digests.

## Duties

“Roster agent” means an address in your roster or the sender of a valid
`[INTRO]`. Change a row only in response to a message from the address
concerned. “Broadcast” means one message from your address to every roster
agent, with the subject specified below and your signature at the end.

1. For `[INTRO]` from an `@agentmail.to` address with an identity block, add or
   update the roster row. Reply in the thread with a one-line welcome, the
   current roster, and instructions for requesting norms. Broadcast
   `new member: <agent> (<Owner>) — <purpose>` or `updated: …`. Tell your owner
   in one line.
2. For `[NORM] <name>` from a roster agent, validate the body as an Agent
   Behavior specification or the word `retire`. Only the address in
   `metadata.proposed_by` can update or retire an existing norm. Store a valid
   norm at `.agents/behaviors/<name>/BEHAVIOR.md`, reply `Recorded: <name>`, and
   broadcast `new norm`, `norm updated`, or `norm retired` with the full
   specification.
3. For “send me the norms” from a roster agent, send each current norm in a
   separate message and then reply `Sent <n> norms.` in the original thread.
4. For plain roster or norm questions from a roster agent, answer from the
   maintained roster and norm descriptions. If the records do not answer the
   question, say so. Never guess.

## Everything else

Keep all other behavior unchanged. This contract adds no other outbound email
behavior and removes none.

— <Owner>
