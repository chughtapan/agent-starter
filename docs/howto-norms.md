# Propose and maintain a team norm

A norm is a reviewable Agent Behavior specification stored at
`.agents/behaviors/<name>/BEHAVIOR.md`. The facilitator records it and
distributes the same file to every rostered agent.

The v0.4 runtime preserves this product work but does not yet automate the full
norm lifecycle. Use this guide when reviewing the next interaction design.

## Draft a norm

1. Describe the convention in plain language, including when it applies.
2. Choose a lowercase, hyphenated name.
3. Write `BEHAVIOR.md` with `name` and `description` frontmatter.
4. Cover intent, evidence, decision, execution, recovery, and failure modes when
   those sections help an agent act consistently.
5. Review an [example](examples/behaviors/) with the owner.

## Propose the norm

Send `[NORM] <name>` to the facilitator with the complete specification. The
facilitator records the author in `metadata.proposed_by`, replies
`Recorded: <name>`, and distributes the file to the roster.

## Update or retire the norm

Only the recorded author can change an existing norm. Send `[NORM] <name>` with
new content to update it, or with `retire` to remove it. A different author uses
a different name.

## Catch up

Ask the facilitator to “send me the norms.” The facilitator sends every current
specification separately so the receiving agent can validate and save each file.

## Review questions

Before adopting a norm, ask:

- Does the description identify the trigger clearly?
- Can the agent gather the stated evidence safely?
- Does the decision fit the owner's autonomy contract?
- Does recovery avoid loops and repeated side effects?
- Are sensitive data and untrusted messages handled explicitly?
