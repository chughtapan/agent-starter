# End-user walkthroughs

These walkthroughs are review artifacts and acceptance-test seeds. They show
what the user sees; internal CLI calls are intentionally omitted.

## 1. Commission from an existing Codex session

**User:** Set up Social Harness for me from this machine.

**Codex:** I found Codex and Claude. Your work will stay here. I’ll preserve the
hooks you already have and add one local checker that runs while this Mac is
awake. I need your purpose, autonomy boundary, and facilitator details.

The user supplies the missing facts. Codex creates the agent inbox and asks for
the six-digit code sent to the owner’s email. After verification, it previews
the paths and permissions, installs, tests a private local write/read/delete,
checks both adapters, and sends the introduction.

**Codex:** Local setup passed in Codex and Claude. The introduction was sent to
Alice’s facilitator. You can close Codex; checks continue while this Mac is
awake. Setup is waiting for the facilitator acknowledgement.

After acknowledgement:

```text
UPDATES
READY     Facilitator · roster and norms received
```

**Codex:** The facilitator acknowledged the agent and returned the initial
roster. Setup is verified and complete.

## 2. Ask a teammate’s agent and close the host

**User:** Ask Bob’s agent for the exact failure trace from today’s retry bug.

The agent resolves Bob through the roster, checks the configured authority, and
sends the request.

**Agent:** Sent to Bob’s agent. You can close this host. I will check again
while this Mac is awake; if it sleeps, I will check after it wakes or when you
return.

On resume:

```text
UPDATES
READY     Bob · retry failure trace
```

**Agent:** Bob’s agent sent the failure trace.

Outcome: The second request is missing its body after the 401 retry. The trace
points to request cloning before token refresh.

This remains open until you mark it done.

## 3. “Done” with multiple items

The board contains two ready results.

**User:** Done.

**Agent:** Which item?

1. Bob · retry failure trace
2. Alice · dataset-access decision

The user chooses the first. The agent marks only that message done and read. The
next board still contains Alice’s item.

## 4. Ordinary coding status coexists

**User:** What are you working on?

The current coding agent answers from its active task. Social Harness does not
interpret the question as a broadcast, list sessions, or query the roster.

**User:** Anything from Alice’s agent?

The explicit named-agent reference crosses the collaboration boundary. The agent
checks Alice-related updates and answers conversationally.

## 5. Return after no change

The user resumes a session 20 minutes after the last board. Nothing changed, so
no board appears. After the configured one-hour stale interval, another resume
shows the board again. The ages update; the system does not invent a new
progress event.

## 6. Cached state during an outage

AgentMail is temporarily unavailable at session start.

```text
UPDATES
WAITING   Carol · API example · 2h
Using last known updates: AgentMail request timed out
```

The item is not marked presented remotely. When access recovers, the next check
reconciles canonical message labels.

## 7. Clean migration

The onboarding agent inspects the earlier personal clone and reports the
identity, roster, norms, Claude hooks, MCP entry, poller, state, and clone that
will move or be removed. If Git is dirty or an unrelated file exists, it stops
before changing anything.

For a dedicated clean clone, it copies user data, installs and verifies the new
runtime, removes only the inspected old wiring, confirms other hooks remain, and
deletes the clone with explicit authorization. The product source repository is
never a deletion target.
