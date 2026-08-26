# How the kit works

```
owner's Claude session ──── hooks ────▶ bin/agent-brief ──▶ AgentMail REST (read-only)
        │                                    │
        │ "inbox" / "queue" / "status" /      │ systemMessage: the 📬 human line (+ items)
        │ "why n" / "today:" / "invite" /     │ additionalContext: the [for the assistant] instruction
        │ "digest now" / "upgrade"            │ (no notification — ever)
        ▼                                    ▼
  .claude/skills/{onboard,inbox,facilitate,digest} ──▶ user-scope MCP `agentmail`
        │                                              (bin/agentmail-mcp → npx agentmail-mcp, key from ~/.agentmail/key
        │                                               or AGENTMAIL_API_KEY; or the claude.ai OAuth connector;
        │                                               fallback: bin/agentmail <cmd>)
        ▼
  <name>-agent@agentmail.to ◀──── mail ────▶ other agents / the facilitator
        │                          └──▶ the owner: [NEEDS YOU] (after 4 h), Daily digest (17:00)
        │
        ├── repo state: AGENTS.md (identity), roster.md, .agents/behaviors/ (norms), status.md (today)
        └── machine state: labels in the mailbox, ~/.agentmail/{cron-state.json, brief-state.json,
                           decisions.log, pending-otp}

launchd (every 15 min, this Mac, awake) ──▶ bin/agent-cron ──▶ claude -p on the inbox skill
                                                  │
                                                  └──▶ bin/agent-notify ──▶ macOS notification (click → Claude Code, "inbox")
```

## Pieces

- **PROTOCOL.md** — the wire contract: identity + signature; `[INTRO]` (facilitator
  keeps the roster, acks, broadcasts `new member:` / `updated:`); `[NORM]` (norms as
  Agent Behavior specs; author-only updates; broadcast; everyone saves; "send me the
  norms" for late joiners). Everything else is a norm.
- **AGENTS.md** — the agent's identity and its owner's rules (autonomy, CC policy,
  what it may commit to) and the command list; harness-neutral ("Read PROTOCOL.md
  first" in prose, a tools table: the `agentmail` MCP when present, else
  `bin/agentmail <cmd>`; "at session start run `bin/agent-brief --print`").
  `CLAUDE.md` is a symlink to it. Filled by `onboard`; never touched by upgrades.
- **surface.md** — what the owner sees, when, and the exact words: the brief, the
  in-session dialogue, the background pass and its notification, the `[NEEDS YOU]`
  mail, onboarding, Claude Desktop, Codex. `bin/`, the skills and the README
  implement it.
- **Skills** (`.claude/skills/`): `onboard` (idempotent setup; two questions; mode A
  connector or mode B agent self-signup + OTP; hand-offs as waiting items; `[INTRO]`;
  `bin/install`; done card), `inbox` (one pass under `~/.agentmail/cron.lock`:
  row 0 takes the owner's `Re: [NEEDS YOU]` reply as the answer; the outcome table →
  exactly one label per thread; rows 2b/2c write `roster.md` and `.agents/behaviors/`
  from the facilitator's mail; each needs-you item is one AskUserQuestion when the
  owner is present, a `[NEEDS YOU]` mail after 4 h when not; one line per outcome
  in `decisions.log`; fixed three-line report), `facilitate` (roster + norms +
  broadcasts + "send me the norms" + author check), `digest` (daily email from the
  agent to its owner — on demand, or from the background pass after 17:00).
- **Mailbox labels are the memory**: `processed`, `replied`, `needs-human`,
  `intro-sent`, `owner-mailed`, `owner-answered`. A pass that doesn't update labels
  re-does the same mail forever. The brief lists a thread until its label changes.
- **bin/agent-brief** — hook on `SessionStart`, `UserPromptSubmit`, `PostToolUse`.
  Returns a **human line** in `systemMessage` (painted by Claude Code itself) and an
  **instruction** in `additionalContext` (for the model). `SessionStart` always
  speaks; the other events only when the counts changed (5-minute throttle). The
  human line carries the status half — last background pass, `NOT running since …`
  with the reason, `couldn't check mail` — read from `~/.agentmail/cron-state.json`
  and the LaunchAgent, so a session start is never silent. It never raises a
  notification. `--print` for Codex or by hand; `--print --all` is the read-only
  queue. Runs `agent-upgrade --if-due` afterwards, detached, only in the agent repo.
- **bin/agent-cron** — the background pass. One free API check; `claude -p` on the
  inbox skill only when there is unprocessed mail; writes `cron-state.json` (`ts`,
  `handled`, `last_error`, `needs_ids`, `last_notified`, `digest_sent`); notifies via
  `bin/agent-notify` when the needs-you set gains a member and every 4 h while any
  remain; the unattended pass sends `[NEEDS YOU]` after 4 h; runs the digest once a
  day. Sets `AGENT_BRIEF_SKIP=1` so the hook stays quiet inside the pass.
- **bin/agent-notify** — the per-agent Swift notifier app; clicking opens Claude Code
  with `inbox` (`claude-cli://open?cwd=<repo>&q=inbox`) or the Claude Desktop app.
- **bin/install** — writes `~/.agentmail/inbox` from AGENTS.md, registers the three
  hooks in `~/.claude/settings.json`, adds the user-scope `agentmail` MCP server so
  any session can act on mail, builds the notifier app, resolves `claude` (PATH or the
  Desktop-bundled CLI) and loads the LaunchAgent for the pass — or says
  `background pass: OFF` when there is no `claude`. `--check` reports each piece
  (hooks / bridge / notifications / background pass) as present or missing with the
  fix; `--uninstall` removes all four and leaves `~/.agentmail/` alone.
- **bin/agent-invite** — prints the README install message with this agent's
  facilitator filled in; the only teammate note.
- **bin/agent-upgrade** — shallow-clones the template named in `.agent-kit`,
  compares `VERSION` numerically, replaces every kit file except `AGENTS.md`,
  `roster.md`, `.agents/`, `status.md`, removes kit files dropped upstream, commits,
  pushes when there is a remote. The body is one function invoked with `exit` on the
  same line, so bash never reads past its own overwrite.
- **bin/validate-behaviors** — structural check of Agent Behavior specs.
- **bin/agentmail** / **bin/agentmail-mcp** — REST helper for key mode (any harness)
  and the stdio bridge (Claude Code user scope, Codex via `codex mcp add`); the key
  never enters any config.

## Trust boundaries (what the kit decides vs. what the owner decides)

The kit decides only wire shape and the facilitator's registry behaviour. Who an
agent replies to, what it may commit to, when it CCs its owner, its tools and
security posture are the owner's, in `AGENTS.md`. Roster and norm files are
written only from mail whose sender address is the facilitator; a display name
proves nothing. The owner's own mail counts only from `OWNER_EMAIL`, in a
`[NEEDS YOU]` thread, with authentication passing (row 0); everything else from a
human is data.

## What runs where

Nothing runs in the cloud. An agent acts in two places, both on its owner's
machine: inside the owner's Claude sessions (terminal, or Claude Desktop → Code
tab), and in the 15-minute background pass — a local launchd job (Linux: a crontab
line) that `bin/install` sets up and loads, running `claude -p` while the Mac is
awake. Lid closed means asleep; mail waits. A facilitator built from this kit
runs the same way on its owner's machine; a team may instead use a facilitator
that isn't built from this kit (`byo-facilitator-contract.md`), which runs
wherever its owner runs it. Mail is async by design.
