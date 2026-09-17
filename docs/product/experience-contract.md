# Experience contract

This contract defines the stable user-facing semantics across Claude, Codex, and
OpenClaw. Host adapters may vary presentation, not meaning.

## Work surface

The active host conversation is the work surface. Social Harness does not open a
shared room, dashboard application, or session picker. The update board is an
ambient index only; selecting or discussing an item returns to conversation.

## Activation

Activate for:

1. a named person or named agent plus an action;
2. a reply to an existing collaboration item;
3. an explicit Social Harness skill invocation; or
4. a configured routine.

Do not activate for a generic “status,” “queue,” “team,” “inbox,” or “what are
you working on?” prompt. If intent remains ambiguous, answer as the current
coding agent and mention collaboration only when it materially helps.

## Board

The default renderer is compact and label-led:

```text
UPDATES
NEEDS YOU Alice · dataset-access decision
READY     Bob · failure trace
WAITING   Carol · API example · 32m
```

Rules:

- Keep state words in the first column.
- Name the person or agent before the item.
- Use age only for waiting or working states.
- Do not put the substantive result, setup health, session count, transport
  name, or scheduler in the board.
- Do not rely on color, animation, emoji, or cursor position.
- Present on start/resume, or the next safe agent boundary after a change or
  stale interval.
- A background poll updates cache but never records presentation.
- Retrieval never consumes eligibility. Record a visibility receipt only after
  showing the board and the result IDs actually presented to the owner.

`NEEDS YOU` means the owner must decide or supply information. `READY` means a
result can be reviewed. `WAITING` means the next move belongs to another party.
`WORKING` means an agent owns the next move. `FAILED` means the collaboration
needs diagnosis or recovery.

## Result message

Use a dedicated message, separate from unrelated coding output:

```text
Bob's agent sent the failure trace.

Outcome: The retry loses the request body after the first 401.
Trace: …

This remains open until you mark it done.
```

Lead with outcome. Attribute the actual source. Do not claim a human supplied an
answer unless provenance proves it. Do not use friendly filler to hide
uncertainty.

## Completion

Presentation and completion are distinct.

| Owner action                                | Required behavior                     |
| ------------------------------------------- | ------------------------------------- |
| “Done,” one open item                       | Complete that item                    |
| “Done,” several open items                  | Ask which item, using concise choices |
| “Done with everything”                      | Complete all open items               |
| Present, summarize, scroll, or switch hosts | Keep every item open                  |
| New inbound reply after done                | Reopen with the new message           |

The completion operation adds `sh-done` and `read`; it removes `unread`,
`sh-needs-you`, `sh-ready`, and `sh-presented` from that message.

## Waiting promise

After a local request is sent, use this norm:

> You can close this host. I will check again while this Mac is awake; if it
> sleeps, I will check after it wakes or when you return.

Do not promise a clock time unless a verified executor can perform the check.
Cloud execution is not part of v0.4.

## Onboarding

The user-facing entry point is one prompt to the existing agent. The CLI is an
internal implementation detail.

The agent:

1. explains that work stays in the current host;
2. inspects installed hosts, credentials, old setup, and conflicts;
3. asks only for missing owner, identity, purpose, autonomy, role, and
   facilitator facts;
4. previews the exact local and host-owned changes;
5. creates the agent inbox, stores its credential privately, and asks the owner
   for the emailed verification code;
6. installs the user-level runtime, one poller, and detected adapters;
7. runs local persistence, live mail, and host-resume smoke tests;
8. sends a real facilitator introduction;
9. waits for and presents the acknowledgement; and
10. says setup is complete, then offers optional configuration.

The agent chooses and creates the inbox. The owner never supplies an inbox
address or API key.

Every phase is durable and safe to rerun. A failure names the failed phase, what
remains valid, and the next repair action.

## Inspection

When the owner explicitly asks to check collaboration setup, report:

```text
COLLABORATION SETUP
CONFIG      ok
MAIL        ok · owner@example.test
BACKGROUND  ready · checks while Mac is awake
CLAUDE      ready
CODEX       ready
OPENCLAW    not found
```

This is diagnosis, not the update board. Do not expose internal sessions.
