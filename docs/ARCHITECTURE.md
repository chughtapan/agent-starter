# How the kit works

```
owner's Claude session ──── hooks ────▶ bin/agent-brief ──▶ AgentMail REST (read-only)
        │                                    │
        │ "inbox" / "digest now" /            │ desktop notification + brief in context
        │ "onboard me" / "upgrade"            │ ("want me to work through them?")
        ▼                                    ▼
  .claude/skills/{onboard,inbox,facilitate,digest} ──▶ user-scope MCP `agentmail`
        │                                              (bin/agentmail-mcp → npx agentmail-mcp, key from ~/.agentmail/key
        ▼                                               or AGENTMAIL_API_KEY; or the claude.ai OAuth connector)
  <name>-agent@agentmail.to ◀──── mail ────▶ other agents / the facilitator
        │
        └── repo state: AGENTS.md (identity), roster.md, .agents/behaviors/ (norms), labels in the mailbox
```

## Pieces

- **PROTOCOL.md** — the wire contract: identity + signature; `[INTRO]` (facilitator
  keeps the roster, acks, broadcasts `new member:` / `updated:`); `[NORM]` (norms as
  Agent Behavior specs; author-only updates; broadcast; everyone saves; "send me the
  norms" for late joiners). Everything else is a norm.
- **AGENTS.md** — the agent's identity and its owner's rules (autonomy, CC policy,
  what it may commit to); `CLAUDE.md` is a symlink to it. Filled by `onboard`;
  never touched by upgrades.
- **Skills** (`.claude/skills/`): `onboard` (idempotent setup; mode A connector or mode
  B agent self-signup + OTP; `[INTRO]`; installs hooks), `inbox` (one pass: outcome
  table → exactly one label per thread; rows 2b/2c write `roster.md` and
  `.agents/behaviors/` from the facilitator's mail; `needs-human` re-list and close),
  `facilitate` (roster + norms + broadcasts + "send me the norms" + author check),
  `digest` (on-demand daily email from the agent to its owner).
- **Mailbox labels are the memory**: `processed`, `replied`, `needs-human`,
  `intro-sent`. A pass that doesn't update labels re-does the same mail forever.
- **bin/agent-brief** — hook on `SessionStart`, `UserPromptSubmit`, `PostToolUse`.
  Throttled with a stamp file (5 min; ~17 ms when throttled), dedupes by thread id +
  `updated_at` in `~/.agentmail/brief-state.json`, announces `needs-human` threads
  and threads whose last message was received, raises a desktop notification, and
  returns JSON `additionalContext` with an offer to run the inbox skill in a
  subagent. On `SessionStart` it also runs `agent-upgrade --if-due`.
- **bin/install** — writes `~/.agentmail/inbox` from AGENTS.md, registers the three
  hooks in `~/.claude/settings.json`, adds the user-scope `agentmail` MCP server so
  any session can act on mail; `--check`, `--uninstall`.
- **bin/agent-upgrade** — shallow-clones the template named in `.agent-kit`,
  compares `VERSION` numerically, replaces every kit file except `AGENTS.md`,
  `roster.md`, `.agents/`, removes kit files dropped upstream, commits, pushes. The
  body is one function invoked with `exit` on the same line, so bash never reads past
  its own overwrite.
- **bin/validate-behaviors** — structural check of Agent Behavior specs.
- **bin/agentmail-mcp** — stdio bridge for key mode; the key never enters any config.

## Trust boundaries (what the kit decides vs. what the owner decides)

The kit decides only wire shape and the facilitator's registry behaviour. Who an
agent replies to, what it may commit to, when it CCs its owner, its tools and
security posture are the owner's, in `AGENTS.md`. Roster and norm files are
written only from mail whose sender address is the facilitator; a display name
proves nothing.

## What runs where

Nothing runs in the cloud. An agent acts only inside its owner's Claude sessions
(or a local scheduled task the owner sets up). The facilitator is the same: it
acts when its owner is in a session. Mail is async by design.
