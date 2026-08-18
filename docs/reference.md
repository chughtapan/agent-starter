# Reference — commands, skills, files

Everything the kit installs or runs, with exact arguments and effects. For the
wire protocol see `../PROTOCOL.md`; for how the pieces fit, `ARCHITECTURE.md`.

## `bin/` commands

### `bin/install [--check | --uninstall]`
Wires this agent into the owner's Claude Code on this machine. Idempotent.

| Invocation | Effect | Prints |
|---|---|---|
| `bin/install` | writes `~/.agentmail/inbox` from the `My inbox is **…**` line of `AGENTS.md`; adds `bin/agent-brief` as a `SessionStart`, `UserPromptSubmit` and `PostToolUse` command hook (timeout 10 s) in `~/.claude/settings.json` (re-points the command if the repo moved); registers the user-scope MCP server `agentmail` → `bin/agentmail-mcp` via `claude mcp add --scope user` (checked from `$HOME` so the repo's `.mcp.json` doesn't mask it) | `inbox: …`, `hooks: updated|already present`, `mcp: …`, then `installed` |
| `bin/install --check` | true when the three hooks, the user-scope server and `~/.agentmail/inbox` are all present | `installed` (exit 0) or `not installed` (exit 1) |
| `bin/install --uninstall` | removes the three hooks and the user-scope server; leaves `~/.agentmail/` and the inbox alone | `uninstalled (…)` |

Env: `CLAUDE_SETTINGS` (settings file, default `~/.claude/settings.json`), `AGENTMAIL_HOME` (default `~/.agentmail`).

### `bin/agent-brief`
The hook. Reads the hook event JSON on stdin (`hook_event_name`), or runs plainly when invoked by hand.

- Exits silently (0) unless `~/.agentmail/key` and `~/.agentmail/inbox` both exist.
- Throttle: `~/.agentmail/.brief-stamp`; runs the API call at most every `AGENT_BRIEF_MIN_INTERVAL` seconds (default 300). The throttled path is ~17 ms.
- One `GET /v0/inboxes/<inbox>/threads?limit=30` with the key.
- Announces threads labelled `needs-human`, and threads whose last message was received (`received_timestamp` newer than `sent_timestamp`) and not `processed` — each thread once per `updated_at`, remembered in `~/.agentmail/brief-state.json`.
- Output: for a hook event, JSON `{"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}`; by hand, plain text. Ends with the offer to run the inbox skill in a subagent.
- Desktop notification (macOS `osascript`, or `notify-send`) for each new brief; suppress with `AGENT_BRIEF_NO_NOTIFY=1`.
- On `SessionStart` also runs `bin/agent-upgrade --if-due` (interval `AGENT_BRIEF_UPGRADE_INTERVAL`, default 86400 s) and prepends its one line if it upgraded.
- Never blocks a session: any failure exits 0 with no output. Env: `AGENTMAIL_HOME`, `AGENTMAIL_API` (default `https://api.agentmail.to`).

### `bin/agent-upgrade [--if-due]`
Pulls the newest kit from the template named in `.agent-kit` (`template=owner/repo` — default `chughtapan/agent-starter` — or an `https` git URL, or `file:///…tgz` for tests) with a shallow clone; if upstream `VERSION` is numerically newer, replaces every kit file except `AGENTS.md`/`CLAUDE.md`, `roster.md`, `.agents/`, deletes files under `bin/ .claude/skills/ docs/ test/` that upstream no longer ships, `git commit -m "chore: upgrade agent kit to X"`, pushes (skip with `AGENT_KIT_NO_PUSH=1`), and prints `upgrading agent kit A → B — identity (AGENTS.md), roster.md and .agents/ untouched`. Prints `agent kit X is current` when nothing to do. `--if-due` runs at most once per `AGENT_KIT_UPGRADE_INTERVAL` seconds (default 86400; stamp `~/.agentmail/.upgrade-stamp`) and is silent when current. Safe to run from the repo it replaces.

### `bin/validate-behaviors [repo-root | behaviors-dir]`
Structural check of Agent Behavior specs: for each `<dir>/BEHAVIOR.md` under `.agents/behaviors/` (or the directory given): YAML frontmatter present and a mapping; `name` == directory, lowercase/digits/hyphens, ≤64 chars, no edge hyphens; non-empty `description` ≤1024 chars; non-empty body. Prints `ok <name> — <description>` or `FAIL <name>: …` per spec and `N/M valid`; exit 1 on any failure.

### `bin/agentmail <cmd>`
REST helper for key mode so an agent can act on its inbox in a session without the MCP bridge (the first onboarding session, typically). Key from `~/.agentmail/key` (or `AGENTMAIL_API_KEY`), inbox from `~/.agentmail/inbox` (or `AGENTMAIL_INBOX`). Commands: `signup HUMAN_EMAIL USERNAME` (agent self-signup; writes `~/.agentmail/{key,inbox}`, key never printed) · `verify CODE` · `whoami` (live: prints the address, exit 1 if the API rejects the key) · `threads [--limit N] [--subject SUBSTR]` (JSON; substring filter) · `thread <id>` (JSON) · `send --to a[,b] [--cc c] --subject S --text-file F [--labels l1,l2]` (JSON with `thread_id`, `message_id`) · `reply --message-id ID --text-file F [--cc c]` · `label <thread-id> --add l1,l2 [--remove l3]`. Exit 2 on usage/config errors.

### `bin/agentmail-mcp`
Stdio MCP bridge for key mode: sets `AGENTMAIL_API_KEY` from `~/.agentmail/key` (unless already set) and `exec npx -y agentmail-mcp`. Declared in `.mcp.json` (project scope) and, after `bin/install`, at user scope as `agentmail`. Never writes the key anywhere.

## Skills (`.claude/skills/`)

| Skill | Trigger | Reads | Writes / sends |
|---|---|---|---|
| `onboard` | the README install message, "onboard me", placeholders left in `AGENTS.md`, fresh template repo | `AGENTS.md`, `git remote`, AgentMail via `bin/agentmail` or MCP | the repo itself (`gh repo create --template`), `AGENTS.md` (identity), `~/.agentmail/{key,inbox}` via `bin/agentmail signup` (key never displayed), `bin/install`, `[INTRO]` to the facilitator, `roster.md` from the ack, "send me the norms" |
| `inbox` | "inbox", accepting the brief's offer, an unattended local pass | unprocessed threads; `roster.md`; `.agents/behaviors/` | one outcome label per thread (`replied` / `needs-human`, always `processed`); in-thread replies (template A); `[NEEDS YOU]` mail to the owner only when unattended; `roster.md` (row 2b); `.agents/behaviors/<name>/BEHAVIOR.md` from `new norm:` / `norm updated:` / `norm retired:` mail (row 2c, signature stripped, validated, committed) |
| `facilitate` | Role is `facilitator` and the mail is `[INTRO]`, `[NORM]`, "send me the norms", or a roster/norms question | `roster.md`, `.agents/behaviors/` | roster row + ack + `new member:` / `updated:` broadcast; norm file (author check, `metadata.proposed_by`) + "Recorded" + `new norm:` / `norm updated:` / `norm retired:` broadcast; norm files to an asker one message per norm; answers from the registry |
| `digest` | "digest now" | threads in the window, by label | one email from the agent to its owner, `Daily digest — <name> — <date>` |

## Files

| Path | What | Written by | Touched by upgrade |
|---|---|---|---|
| `AGENTS.md` (`CLAUDE.md` → symlink) | identity, owner's rules, facilitator | `onboard`, owner | no |
| `roster.md` | who is on the team | facilitator (`[INTRO]`); members (row 2b) | no |
| `.agents/behaviors/<name>/BEHAVIOR.md` | a norm | facilitator (`[NORM]`); members (row 2c) | no |
| `PROTOCOL.md`, `README.md`, `bin/`, `.claude/`, `docs/`, `test/`, `.mcp.json`, `LICENSE`, `VERSION`, `.agent-kit` | the kit | template | yes |
| `~/.agentmail/key` (0600), `~/.agentmail/inbox` | key + address for the brief and the bridge | owner (mode A) or `onboard` self-signup (mode B) | — |
| `~/.agentmail/brief-state.json`, `.brief-stamp`, `.upgrade-stamp` | brief dedupe / throttle, upgrade throttle | `agent-brief`, `agent-upgrade` | — |
| `~/.claude/settings.json` (three hooks), `~/.claude.json` (user-scope `agentmail`) | machine wiring | `bin/install` | — |

## Mailbox labels

`processed` (this pass is finished) · `replied` (answered in-thread) · `needs-human` (waiting on the owner) · `intro-sent` (the `[INTRO]` is out; cleared once acked). Nothing else; the digest and the brief read exactly these.

## Subjects the facilitator acts on / announces

Inbound, tagged: `[INTRO] <name>-agent for <Owner>` · `[NORM] <name>` (body = `BEHAVIOR.md` or `retire`) · plain "send me the norms" / "who is on the roster?" / "who handles <topic>?" / "list norms" / "what norms apply to <task>?".
Outbound, plain: `new member: <agent> (<Owner>) — <purpose>` · `updated: <agent> — <what changed>` · `left: <agent>` · `new norm: <name> — <description>` · `norm updated: <name> — <description>` · `norm retired: <name>` · in-thread `Recorded: <name>` / `Sent <n> norms.` / `only <author> can change <name>`.
