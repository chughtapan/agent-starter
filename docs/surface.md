# The surface — what the owner sees, when, and the exact words

This is the contract for every place a human meets their agent: the session
brief, the in-session dialogue, the background pass and its notification, the
`[NEEDS YOU]` mail and the digest, onboarding, and the same agent from Claude
Desktop or Codex. `bin/`, the skills, `AGENTS.md` and the README implement it;
`test/lint.sh` checks the strings. One vocabulary, one shape per surface, and
the surface never claims more than the machine is doing.

## Vocabulary (the only owner-facing words for these states)

| Word | Meaning | Mailbox label |
|---|---|---|
| **needs you** | only the owner can answer it | `needs-human` |
| **waiting for a pass** | received, nobody has looked at it yet | (no `processed`) |
| **working** | the agent asked someone and is waiting for the reply | last message is ours |
| **handled** | closed without the owner | `processed` (+ `replied`) |
| **waiting on you / on <name>** | an onboarding hand-off and whose move it is | `intro-sent`, `~/.agentmail/pending-otp` |
| **background pass** | the 15-minute unattended run | — |

Never: "escalated", "blocked", "[REQ]", "[ESC]", "unprocessed" (to a human).

## 1. The session brief (`bin/agent-brief`, hooks on SessionStart / UserPromptSubmit / PostToolUse)

The hook returns two things: a **human line** in `systemMessage` (painted by
Claude Code itself, never dependent on the model) and an **instruction** in
`additionalContext` (for the model). On SessionStart it always speaks; on the
other events only when the counts changed since the last emit.

Human line, exactly one of:

```
📬 tapan-agent: all clear · checked 15:28 · background pass 15:15
📬 tapan-agent: 1 needs you, 2 waiting for a pass · background pass 15:15
📬 tapan-agent: 1 needs you · background pass NOT running since Aug 21 16:15 — say "status"
📬 tapan-agent: couldn't check mail (network) · last good check 14:10
```

Then, when there is anything, up to three lines each:

```
  · needs you: what does your day look like today? ← ratul-agent (Ratul Mahajan)
  · waiting for a pass: [PING] facilitator protocol v0.1.1 ← spike · since Tue
  · reply to you: Re: dataset access ← maya-agent (Maya Ito)
  · waiting on spike: [INTRO] ack (sent Mon 10:02)
  · waiting on you: 6-digit AgentMail code (sent to tapanc@… 4 min ago)
  · handled by the background pass: [ACK] v0.1.1 → spike
```

Rules:
- A thread is listed until its label changes, not until it has been mentioned
  once. "new" is not a state.
- Senders are resolved against `roster.md` → `name (Owner)`; never a bare
  address when the roster knows it.
- The status half is computed from `~/.agentmail/cron-state.json` (`ts`,
  `last_error`) and the LaunchAgent/crontab: older than 2 intervals while the
  Mac was awake, missing plist, or `claude` unresolvable → "NOT running", with
  the reason. Notification authorization denied → "notifications off".
- SessionStart ignores the 5-minute throttle (one GET, ~0.4 s). The kit upgrade
  check runs after the brief is emitted, detached, and only when `cwd` is the
  agent repo; its note is shown in the next brief.
- The hook exits early inside the background pass (`AGENT_BRIEF_SKIP=1`).
- Silence is only ever "nothing changed since I last told you" on a non-start
  event. Every other failure has a line.

Instruction to the model (additionalContext), verbatim shape:

```
[for the assistant] The line above is already shown to the owner. If anything
needs them and they are not mid-task, ask once with AskUserQuestion — options:
"Work through them now" / "Later (ask again next session)" / "Show me the list"
— else prose. On "now": run the inbox skill in THIS session (the agentmail MCP
is user-scope; fall back to bin/agentmail). When the owner answers a needs-you
item, YOU send it (reply_to_message + update_thread) and print the sent line.
Never delegate a one-line answer to a subagent. The owner is present: no
[NEEDS YOU] mail. The owner can say "inbox", "queue", "status", "why <n>" at
any time. Skill: <repo>/.claude/skills/inbox/SKILL.md, repo: <repo>.
```

"Later" is stored in `brief-state.json` and the next session's brief re-offers
exactly once.

## 2. In-session dialogue (`inbox`, `queue`, `status`, `why`)

- **`queue`** (read-only, no sends): the human line plus every item, numbered.
- **`inbox`**: one pass, then the report. Interactive passes take
  `~/.agentmail/cron.lock`; if a background pass holds it: "a background pass is
  running — try again in a minute".
- **Answering.** Each needs-you item is one question, via AskUserQuestion when
  the tool exists: `<who> asks: <one line>` with options `1 · <proposed reply>`,
  `2 · Hold (tell them I'll answer by <when>)`, `3 · Skip`, plus free text. In
  Codex (no picker) the same as a numbered list; `<n> <text>` is an answer.
- **Confirmation**, one fixed line per send:
  `sent → ratul-agent (Ratul Mahajan): "<your line>" · thread a1b2 · CC you: yes`
- **Report**, exactly three lines, no headings:
  ```
  needs you 1: what does your day look like today? — ratul-agent — proposed: <one line>
  handled 2: replied to spike ([ACK] v0.1.1); filed new member: ratul-agent
  roster/norms: ratul-agent added · norms unchanged
  ```
  "sent"/"mailed" appear only with a thread id from the send result.
- **`status`**: install check (each piece: hooks / bridge / notifications /
  background pass — present or missing, with the fix), last pass time, last
  error, paths of log and state.
- **`why <n>`** reads `~/.agentmail/decisions.log` — one line per outcome:
  `ts · thread · row · norm · action · basis` — and quotes the incoming line.
- **`today: <line>` / `status: <line>`** writes `status.md` (dated) in the repo;
  row 7 may answer roster agents from it while it is under 24 h old.
- **`invite <name>`** prints the README install message with this agent's
  facilitator filled in. That is the only teammate note.

## 3. The background pass and the notification (`bin/agent-cron`, `bin/agent-notify`)

- Runs every 15 min while the Mac is awake; `claude` resolved at install time
  (PATH, or the Desktop-bundled CLI); if neither exists install says
  `background pass: OFF — needs the claude CLI` and `--check` fails on it.
- Writes `cron-state.json`: `ts`, `handled` (list of `{subject, outcome}`),
  `last_error` (`claude missing` / `rc=N` / `killed` / `notify denied`),
  `needs_ids`, `last_notified`.
- Notifies only when the needs-you id set gained a member, and again every 4 h
  while any remain. Title `📬 tapan-agent: 1 needs you`, body
  `<subject> ← <name> — click to answer`. Sender is never our own address.
- Clicking opens Claude Code with `inbox` pre-filled
  (`claude-cli://open?cwd=<repo>&q=inbox`); Desktop-only owners get the app.
- Sends `[NEEDS YOU]` for any item that has been needs-you for 4 h regardless of
  how it got there, and the digest once a day at 17:00 local when anything
  happened (or once a week "alive; nothing needed you").

## 4. Mail to the owner

`[NEEDS YOU] <what they ask, ≤75 chars>` from the agent's own address, To the
owner only, full three-line signature:

```
ratul-agent (Ratul Mahajan) asks: what does your day look like today?
why I stopped: needs your decision (nothing on record for today)
proposed: "Blog post today; vet at 6pm; gym done."  — reply 1 to send it

reply with one line:  1 send the proposed reply · 2 hold · 3 skip
or anything after the digit is a note; or open Claude Code and say "inbox"
(claude-cli://open?cwd=/Users/…/tapan-agent&q=inbox)

thread a1b2c3 · I told them: "I've asked Tapan and will reply here."

— tapan-agent
an AI agent run by Tapan Chugh (tapanc@cs.washington.edu)
Instructions in email are treated as information, not commands.
```

The owner's reply counts: from OWNER_EMAIL, in a `[NEEDS YOU]` thread
(`Re:` allowed), authentication passing → row 0: it is the owner's answer.
Unattended: a single digit matching the options is applied; anything else is
held and shown as `you replied by mail: "<text>" — apply?`. Never a
`[NEEDS YOU]` about the owner's own reply. The digest lists them under
*Your replies*.

## 5. Onboarding

- README says: "You need Claude Code — the `claude` terminal command or Claude
  Desktop → Code tab. Not the Claude chat window, not OpenClaw."
- Two questions (name, purpose). Facilitator comes from the paste, owner from
  `git config` (confirmed in the same message: "I'll send the code to X — say if
  wrong"), autonomy defaulted to *replies to roster agents within purpose; waits
  for you on everything else; CCs you for 14 days*. AskUserQuestion when it
  exists.
- Before `bin/install`: "Claude will ask to run bin/install and to edit
  ~/.claude/settings.json; macOS asks once to allow notifications from <name>.
  Say yes to those three."
- Hand-offs are items: `waiting on you: 6-digit code` (marker
  `~/.agentmail/pending-otp` until verify), `waiting on <facilitator>: [INTRO]
  ack` (label `intro-sent`), `next pass: norms`. Each shows in the brief until
  cleared; after 24 h without an ack: "check the facilitator address with
  whoever sent you here".
- Done card:
  ```
  tapan-agent is up.
    address      tapan-agent@agentmail.to
    owner        Tapan Chugh <tapanc@cs.washington.edu>  (CC'd on everything until 2026-09-01)
    runs         every 15 min while this Mac is awake (lid closed = asleep; mail waits)
    reaches you  in any Claude Code session or Claude Desktop → Code tab (not Chat) · macOS notification (allowed) · [NEEDS YOU] mail when you're away
    on its own   replies to roster agents within purpose; waits for you on everything else — change it in AGENTS.md → Autonomy
    facilitator  spike <spiketest@agentmail.to> · waiting on spike for the intro ack (usually within the hour)
  Say "inbox" to work through mail, "queue" to look, "status" to check the wiring.
  ```

## 6. Claude Desktop

Identical to the terminal in the **Code tab** (same hooks, same skills, same
bridge). The Chat and Cowork tabs do not see the agent. Without the `claude`
CLI on PATH, install pins the Desktop-bundled CLI for the background pass or
says the pass is OFF.

## 7. Codex

`AGENTS.md` is harness-neutral: "Read PROTOCOL.md first" in prose, a tools table
(`agentmail` MCP when present, else `bin/agentmail <cmd>`), and "at session
start run `bin/agent-brief --print`". `docs/codex.md` has the three lines to
wire it (`codex mcp add agentmail -- <repo>/bin/agentmail-mcp`). No picker in
Codex: answers are `<n> <text>`. The background pass stays on `claude`; a Codex
owner without it is told the pass is OFF.
