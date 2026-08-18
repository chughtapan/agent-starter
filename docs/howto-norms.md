# How to propose, update, retire and catch up on norms

You'll end with a team convention written as an Agent Behavior spec, recorded by
the facilitator, and present as `.agents/behaviors/<name>/BEHAVIOR.md` in every
agent's repo.

## Prerequisites
- Your agent is onboarded (`bin/install --check` says `installed`; `roster.md` exists).
- You know the facilitator's address (it's in `AGENTS.md`).

## Propose a norm

1. In a Claude session inside your agent repo, say what the convention is in
   plain words, e.g. *"propose a norm: review requests name the file, the
   deadline and the kind of review; the reviewer's agent replies with an ETA."*
   Your agent drafts a `BEHAVIOR.md` with you: frontmatter `name` (lowercase,
   hyphens) and `description` (when it applies), then a body — ideally
   *Intent / Evidence / Decision / Execution / Recovery / Failure modes*.
   `docs/examples/behaviors/` has seven to start from.
2. Check it: `bin/validate-behaviors <dir-with-the-draft>` → `1/1 valid`.
3. Your agent sends `[NORM] <name>` to the facilitator with the file as the body.
4. The facilitator replies in-thread `Recorded: <name>` and broadcasts
   `new norm: <name> — <description>` with the file. Every agent's next inbox
   pass saves it; the brief announces it.

**Verify:** `ls .agents/behaviors/<name>/BEHAVIOR.md` in your repo after your
next `inbox` pass, or `bin/validate-behaviors`.

## Update or retire a norm you authored

Only the address in the norm's `metadata.proposed_by` can change it.
1. Send `[NORM] <name>` again with the new content (or the single word
   `retire`).
2. The facilitator replies `Updated: <name>` / `Retired: <name>` and broadcasts
   `norm updated: …` / `norm retired: <name>`; every agent overwrites or removes
   the directory on its next pass.

Someone else's `[NORM] <existing-name>` gets `only <author> can change <name>;
propose a differently named norm` and nothing changes.

## Catch up (joined late, or lost a file)

Say **"send me the norms"** in a session (or your agent asks the facilitator
itself after its `[INTRO]` ack). The facilitator sends every current norm, one
message per norm under a `new norm:` subject; your next inbox pass saves them.

## Look something up

Ask the facilitator in plain words from a session: "list norms", "what norms
apply to <task>?", "who handles <topic>?", "who is on the roster?".

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `FAIL <name>: name '…' != directory` | frontmatter `name` and directory differ | rename one; they must match |
| facilitator replies "only <author> can change …" | you're not the author | propose under a new name |
| a norm broadcast arrived but no file appeared | the pass hasn't run yet, or `validate-behaviors` failed on the received file | say `inbox`; the report says why it kept nothing |
| you have no `roster.md` | your `[INTRO]` hasn't been acked | wait for the facilitator's owner to open a session; then `inbox` |
