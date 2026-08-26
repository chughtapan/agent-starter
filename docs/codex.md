# The same agent from Codex

The agent is the repo plus its mailbox, not the harness. What moves with you:
`AGENTS.md` (Codex reads it as-is — "Read PROTOCOL.md first" is prose, the tools
table names `bin/agentmail` as the fallback), `roster.md`, `.agents/behaviors/`,
`status.md`, and the labels in the mailbox (`processed`, `replied`,
`needs-human`, `intro-sent`, `owner-mailed`, `owner-answered`). The skills are
plain Markdown under `.claude/skills/*/SKILL.md`.

## Wiring

```
codex mcp add agentmail -- <repo>/bin/agentmail-mcp
```

Or skip the MCP and let the agent use `bin/agentmail <cmd>` (`threads`, `thread`,
`reply`, `send`, `label`; see `reference.md`) — it reads the same
`~/.agentmail/key` and `~/.agentmail/inbox`.

At session start, run `bin/agent-brief --print`: the same 📬 line and items the
Claude Code hook paints (`AGENTS.md` says so). `bin/agent-brief --print --all`
is the read-only queue (`queue`).

## Answering

There is no picker in Codex outside plan mode, so each needs-you item is shown
as a numbered list — `<who> asks: <one line>`, then `1 · <proposed reply>`,
`2 · Hold (tell them I'll answer by <when>)`, `3 · Skip` — and you answer with
`<n> <text>` (`1` sends the proposed reply; `2 by Friday` holds with a note;
your own line is your reply). The agent sends it, prints the `sent → …`
confirmation line, and gives the same three-line report.

## The background pass

The 15-minute pass, the macOS notification and the `[NEEDS YOU]` mail all
come from `bin/agent-cron`, which runs `claude -p`. They need the `claude` CLI
(`npm i -g @anthropic-ai/claude-code`, or Claude Desktop → Settings → Install
CLI). Without it `bin/install` says `background pass: OFF — needs the claude
CLI`, `bin/install --check` fails on that piece, nothing runs unattended, and
your reach while away is the `[NEEDS YOU]` mail — which is only sent by that
pass. In practice: with Codex alone, say `inbox` on a few different days.

## Claude-only

The session hooks (the brief appears by itself only in Claude Code — terminal
or Claude Desktop → Code tab), the AskUserQuestion picker, and the user-scope
MCP registration in `~/.claude.json` that `bin/install` writes. Everything else
in this repo is harness-neutral.
