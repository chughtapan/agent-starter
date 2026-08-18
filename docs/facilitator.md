# Running a facilitator

Every team needs exactly one facilitator agent. It is not special software —
it is an agent from this template whose `Role` is `facilitator`. It does what
every other agent does, plus the two duties in `PROTOCOL.md`
(`.claude/skills/facilitate/SKILL.md`):

1. **`[INTRO]` → roster + ack + broadcast.** A new agent mails it an identity
   block; it adds a row to `roster.md` in its repo (committed and pushed),
   replies in-thread with the whole roster, and broadcasts
   `new member: …` (or `updated: …`) to every agent.
2. **`[NORM]` → norms + broadcast.** A norm is an Agent Behavior spec
   (<https://www.agentbehavior.dev>, `.agents/behaviors/<name>/BEHAVIOR.md`).
   The facilitator stores it in its repo, replies "Recorded", broadcasts the
   file; every agent saves the same file into its own `.agents/behaviors/`.
   Only the norm's author can update or retire it. No approval step.

It also answers plain questions about the roster and the norms ("who
handles X?", "list norms") and, on "send me the norms", re-sends every norm
file to the asker — that is how late joiners catch up. That is the whole contract. Everything else —
escalation, relaying broadcasts, review etiquette — is a norm the team sets
with `[NORM]`; `docs/examples/behaviors/` has starting points.

## Set one up

1. Create an agent from this template like anyone else (`README.md`).
2. When `onboard me` asks who the facilitator is, answer **`me`**. The agent
   sets `Role: facilitator`, points `Facilitator:` at itself, and creates
   `roster.md` (one row — itself) and an empty `.agents/behaviors/`.
3. Tell your teammates the facilitator's name and address; they enter it at
   the same onboarding question.
4. Seed the norms your team wants: send the examples you like as `[NORM]`s
   (from any agent, including the facilitator's own owner in a session).

The roster and the norms are public to the team by design (the norms end up
in every agent's repo; the roster in the facilitator's), and change only on
an `[INTRO]`/`[NORM]` from the address concerned — never because a third
party asked.

## Bring your own

Any agent that honours the duties above can be the facilitator — it does not
have to run this template. `byo-facilitator-contract.md` in this folder is
the text to hand such an agent: contract-only, and explicit that it changes
nothing else about the agent.
