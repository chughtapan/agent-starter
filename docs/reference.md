# Reference — commands, skills, files

Everything the kit installs or runs, with exact arguments and effects. For the
wire protocol see `../PROTOCOL.md`; for how the pieces fit, `ARCHITECTURE.md`;
for what the owner sees and the exact words, `surface.md`.

## `bin/` commands

### `bin/install [--check | --uninstall]`
Wires this agent into the owner's Claude Code on this machine. Idempotent.

| Invocation | Effect | Prints |
|---|---|---|
| `bin/install` | writes `~/.agentmail/inbox` from the `My inbox is **…**` line of `AGENTS.md`; adds `bin/agent-brief` as a `SessionStart`, `UserPromptSubmit` and `PostToolUse` command hook (timeout 10 s) in `~/.claude/settings.json` (re-points the command if the repo moved); resolves `claude` from `PATH` or the Claude Desktop-bundled CLI (`~/Library/Application Support/Claude/claude-code/<ver>/…`); registers the user-scope MCP server `agentmail` → `bin/agentmail-mcp` (`claude mcp add --scope user`, checked from `$HOME` so the repo's `.mcp.json` doesn't mask it); macOS: builds `~/.agentmail/<name>.app` — a small Swift `UserNotifications` binary compiled from `assets/notifier.swift` (`swiftc` from the Xcode CLT; skipped with a note if absent), ad-hoc signed, bundle id `to.agentmail.<name>.notifier` — so notifications carry the agent's name, and fires a welcome notification so the one-time Allow prompt appears at install; loads a launchd LaunchAgent `to.agentmail.<name>.inbox` running `bin/agent-cron` every 900 s with the resolved `claude` pinned as `AGENT_CRON_CLAUDE` (Linux: a crontab line); `AGENT_INSTALL_NO_CRON` skips that step | one line per piece (`inbox:`, `hooks:`, `bridge:`, `notifications:`, `background pass:`), then `installed`. With no `claude` anywhere: `background pass: OFF — needs the claude CLI (Claude Desktop → Settings → Install CLI, or npm i -g @anthropic-ai/claude-code)` and the last line is `installed (background pass OFF)` |
| `bin/install --check` | one line per piece — hooks / bridge / notifications / background pass — `present` or `missing` with the fix. Background pass = LaunchAgent loaded (`launchctl print`) and the pinned `claude` exists; notifications = the notifier app is authorized | `installed` (exit 0) or `not installed: <pieces>` (exit 1) |
| `bin/install --uninstall` | removes the three hooks, the user-scope bridge, the LaunchAgent and the notifier app; leaves `~/.agentmail/` (key, inbox, state) alone | `uninstalled (…)` |

Env: `CLAUDE_SETTINGS` (settings file, default `~/.claude/settings.json`), `AGENTMAIL_HOME` (default `~/.agentmail`).

### `bin/agent-cron`
The background pass, run every 15 min by launchd/cron while the Mac is awake. Takes `~/.agentmail/cron.lock` (the same lock an interactive `inbox` pass takes; 30 min stale). Sets `AGENT_BRIEF_SKIP=1` so the brief hook exits early inside the pass. Cheap pre-check (one threads call) — no unprocessed mail → no Claude call, no tokens. Otherwise runs `claude -p --permission-mode auto` (the binary pinned at install as `AGENT_CRON_CLAUDE`, else `claude` on `PATH`) in the agent repo on the inbox skill, unattended: auto mode approves the safe rows; anything that would have prompted lands as `needs-human`. That unattended pass also sends `[NEEDS YOU]` mail for every item that has been needs-you for 4 h (label `owner-mailed`), and applies a single-digit `Re: [NEEDS YOU]` reply from the owner (row 0).

After each run it writes `~/.agentmail/cron-state.json`: `ts`, `handled` (list of `{subject, outcome}`), `last_error` (`claude missing` / `rc=N` / `killed` / `notify denied`), `needs_ids`, `last_notified`, `digest_sent`. Notifies via `bin/agent-notify` only when the needs-you id set gained a member, and again every 4 h while any remain. Runs the digest skill once a day after 17:00 local (`digest_sent`). Watchdog `AGENT_CRON_TIMEOUT` (a killed run is `last_error: killed`); log at `~/.agentmail/cron.log` (200 KB cap). `AGENT_CRON_DRY=1` stops before any network/claude call; `AGENT_CRON_CLAUDE` overrides the binary. With no `claude` the pass writes `last_error: claude missing` and the brief reports `background pass NOT running`.

### `bin/agent-notify TITLE BODY [URL]`
Desktop notification attributed to the agent: launches `~/.agentmail/<name>.app` via LaunchServices with the text as arguments (`open -n --args`; the app must be LS-launched or macOS refuses the notification authorization). Clicking the notification opens `URL` — agent-cron passes `claude-cli://open?cwd=<repo>&q=inbox` when a `claude` CLI exists, else the Claude Desktop app. Shape used by agent-cron: title `📬 <name>: N needs you`, body `<subject> ← <sender> — click to answer` (sender resolved against `roster.md`, never our own address). Without the app: plain `osascript` (macOS) or `notify-send` (Linux), no click action. Silent no-op on failure or `AGENT_BRIEF_NO_NOTIFY`.

### `bin/agent-brief [--print [--all]]`
The session brief. As a hook it reads the event JSON on stdin (`hook_event_name`: `SessionStart`, `UserPromptSubmit`, `PostToolUse`); `--print` prints the same brief as plain text (Codex, or by hand); `--print --all` prints the read-only queue — the human line plus every item, numbered (what `queue` shows).

- Exits silently (0) unless `~/.agentmail/key` and `~/.agentmail/inbox` both exist; exits early when `AGENT_BRIEF_SKIP=1` (set by agent-cron).
- `SessionStart` always speaks and ignores the throttle (one GET, ~0.4 s). The other events honour `AGENT_BRIEF_MIN_INTERVAL` seconds (default 300, stamp `~/.agentmail/.brief-stamp`) and speak only when the counts changed since the last emit (`~/.agentmail/brief-state.json`).
- One `GET /v0/inboxes/<inbox>/threads?limit=30` with the key.
- Human line, exactly one of: `📬 <name>: all clear · checked HH:MM · background pass HH:MM` · `📬 <name>: N needs you, M waiting for a pass · background pass HH:MM` · `📬 <name>: N needs you · background pass NOT running since <date time> — say "status"` · `📬 <name>: couldn't check mail (network) · last good check HH:MM`. Then, up to three lines each: `needs you:` (`needs-human`), `waiting for a pass:` (last message received, no `processed`), `reply to you:` (a received reply in a thread the agent wrote last), `waiting on <facilitator>:` (`intro-sent`), `waiting on you: 6-digit AgentMail code` (`~/.agentmail/pending-otp`), `handled by the background pass:` (`handled` from cron-state). A thread is listed until its label changes. Senders are resolved against `roster.md` → `name (Owner)`.
- The status half comes from `cron-state.json` (`ts`, `last_error`) and the LaunchAgent/crontab: `ts` older than 2 intervals while the Mac was awake, missing plist, or `claude` unresolvable → `NOT running` with the reason; notification authorization denied → `notifications off`.
- Output for a hook event: JSON with `systemMessage` (the human line and item lines — painted by Claude Code, never dependent on the model) and `hookSpecificOutput.additionalContext` (the `[for the assistant]` instruction in `surface.md` §1: ask once with AskUserQuestion — *Work through them now / Later (ask again next session) / Show me the list* — run the inbox skill in this session, send the owner's answers yourself). "Later" is stored in `brief-state.json` and re-offered exactly once, next session.
- Never raises a desktop notification — that is agent-cron's job.
- After the brief is emitted, and only when `cwd` is the agent repo, runs `bin/agent-upgrade --if-due` detached; its note is shown in the next brief. `AGENT_BRIEF_NO_UPGRADE=1` skips it.
- Never blocks a session. Env: `AGENTMAIL_HOME`, `AGENTMAIL_API` (default `https://api.agentmail.to`).

### `bin/agent-invite <name>`
Prints the README install message (the blockquote under `## Install — tell your Claude`, read from `README.md` at run time) with this agent's facilitator (`Facilitator:` line of `AGENTS.md`) filled in, headed `For <name> — paste this into Claude Code (the terminal, or Claude Desktop → Code tab):` and followed by the "You need Claude Code …" sentence. The `<myname>` blank stays for the teammate. Nothing is sent. Exit 2 when `AGENTS.md` has no facilitator yet. This is the only teammate note; `invite <name>` in a session runs it.

### `bin/agent-upgrade [--if-due]`
Pulls the newest kit from the template named in `.agent-kit` (`template=owner/repo` — default `chughtapan/agent-starter` — or an `https` git URL, or `file:///…tgz` for tests) with a shallow clone; if upstream `VERSION` is numerically newer, replaces every kit file except `AGENTS.md`/`CLAUDE.md`, `roster.md`, `.agents/`, `status.md`, deletes files under `bin/ .claude/skills/ docs/ test/` that upstream no longer ships, `git commit -m "chore: upgrade agent kit to X"`, pushes when there is a remote (skip with `AGENT_KIT_NO_PUSH=1`), and prints `upgrading agent kit A → B — identity (AGENTS.md), roster.md and .agents/ untouched`. Prints `agent kit X is current` when nothing to do. `--if-due` runs at most once per `AGENT_KIT_UPGRADE_INTERVAL` seconds (default 86400; stamp `~/.agentmail/.upgrade-stamp`) and is silent when current. Safe to run from the repo it replaces.

### `bin/validate-behaviors [repo-root | behaviors-dir]`
Structural check of Agent Behavior specs: for each `<dir>/BEHAVIOR.md` under `.agents/behaviors/` (or the directory given): YAML frontmatter present and a mapping; `name` == directory, lowercase/digits/hyphens, ≤64 chars, no edge hyphens; non-empty `description` ≤1024 chars; non-empty body. Prints `ok <name> — <description>` or `FAIL <name>: …` per spec and `N/M valid`; exit 1 on any failure.

### `bin/agentmail <cmd>`
REST helper for key mode so an agent can act on its inbox without the MCP bridge (the first onboarding session, Codex, or any harness without the `agentmail` server). Key from `~/.agentmail/key` (or `AGENTMAIL_API_KEY`), inbox from `~/.agentmail/inbox` (or `AGENTMAIL_INBOX`); `AGENTMAIL_HOME` relocates the whole dir. Commands: `signup HUMAN_EMAIL USERNAME` (agent self-signup; writes `~/.agentmail/{key,inbox}`, key never printed; fails with a hint if that human email already owns an AgentMail org) · `add-inbox USERNAME DIR` (a second inbox in this org — same API key — written to `DIR/{key,inbox}`; for a second agent on the same org, run it with `AGENTMAIL_HOME=DIR`) · `verify CODE` · `whoami` (live: prints the address, exit 1 if the API rejects the key) · `threads [--limit N] [--subject SUBSTR]` (JSON; substring filter) · `thread <id>` (JSON) · `send --to a[,b] [--cc c] --subject S --text-file F [--labels l1,l2]` (JSON with `thread_id`, `message_id`) · `reply --message-id ID --text-file F [--cc c]` · `label <thread-id> --add l1,l2 [--remove l3]`. Exit 2 on usage/config errors.

### `bin/agentmail-mcp`
Stdio MCP bridge for key mode: sets `AGENTMAIL_API_KEY` from `~/.agentmail/key` (unless already set) and `exec npx -y agentmail-mcp`. Declared in `.mcp.json` (project scope) and, after `bin/install`, at user scope as `agentmail`; Codex registers the same command with `codex mcp add agentmail -- <repo>/bin/agentmail-mcp`. Never writes the key anywhere.

## Owner commands (`AGENTS.md` → "When my human says")

| Command | Runs | Sends |
|---|---|---|
| `inbox` | the `inbox` skill, one interactive pass, then the three-line report | replies the owner approves; never `[NEEDS YOU]` while the owner is present |
| `queue` | `bin/agent-brief --print --all` | nothing |
| `status` | `bin/install --check` (each piece present or missing, with the fix) + `bin/agent-brief --print` (last pass, last error) + the paths `~/.agentmail/cron.log`, `~/.agentmail/cron-state.json`, `~/.agentmail/decisions.log` | nothing |
| `why <n>` | reads `~/.agentmail/decisions.log` — one line per outcome, `ts · thread · row · norm · action · basis` — and quotes the incoming line | nothing |
| `today: <line>` / `status: <line>` | writes `status.md` (dated) in the repo and commits it; inbox row 7 may answer roster agents from it while it is under 24 h old | nothing now |
| `invite <name>` | `bin/agent-invite <name>` | nothing |
| `digest now` | the `digest` skill | one email to the owner |
| `who's on the roster?` | shows `roster.md`; asks the facilitator "who is on the roster?" first if it is older than seven days | maybe one plain question to the facilitator |
| `send me the norms` · `what norms do we have?` · `propose a norm …` | see `howto-norms.md` | "send me the norms" / `[NORM] <name>` to the facilitator |
| `upgrade` | `bin/agent-upgrade` | nothing |

## Skills (`.claude/skills/`)

| Skill | Trigger | Reads | Writes / sends |
|---|---|---|---|
| `onboard` | the README install message, "onboard me", placeholders left in `AGENTS.md`, fresh template repo | `AGENTS.md`, `git config`, `git remote`, the pasted message (facilitator), AgentMail via `bin/agentmail` or MCP | asks two questions (name, purpose); owner name/email from `git config`, confirmed in the same message; autonomy defaulted to *replies to roster agents within purpose; waits for you on everything else; CCs you for 14 days*; the repo itself (clone the template → fresh `git init`; `gh repo create --private --source . --push` on top when `gh` is present), `AGENTS.md` (identity), `~/.agentmail/{key,inbox}` via `bin/agentmail signup` (key never displayed; `~/.agentmail/pending-otp` until `verify`), the permissions heads-up, then `bin/install`, `[INTRO]` to the facilitator (label `intro-sent`), `roster.md` from the ack, "send me the norms", the done card (`surface.md` §5) |
| `inbox` | "inbox", accepting the brief's offer, the background pass | `~/.agentmail/cron.lock` (interactive: "a background pass is running — try again in a minute" when held); unprocessed threads; `roster.md`; `.agents/behaviors/`; `status.md` (row 7, under 24 h) | row 0: an authenticated `Re: [NEEDS YOU]` reply from `OWNER_EMAIL` is the owner's answer — unattended, a single digit is applied (label `owner-answered`), anything else is held and shown as `you replied by mail: "<text>" — apply?`; one outcome label per thread (`replied` / `needs-human`, always `processed`); in-thread replies (template A); interactive: one AskUserQuestion per needs-you item (`<who> asks: <one line>` — `1 · <proposed reply>` / `2 · Hold` / `3 · Skip`, or free text), one `sent → …` confirmation line per send, the fixed three-line report; unattended only: `[NEEDS YOU]` mail (`surface.md` §4) for items needs-you longer than 4 h (label `owner-mailed`); one line per outcome in `~/.agentmail/decisions.log`; `roster.md` (row 2b); `.agents/behaviors/<name>/BEHAVIOR.md` from `new norm:` / `norm updated:` / `norm retired:` mail (row 2c, signature stripped, validated, committed; the report says `norm saved: <name>`) |
| `facilitate` | Role is `facilitator` and the mail is `[INTRO]`, `[NORM]`, "send me the norms", or a roster/norms question | `roster.md`, `.agents/behaviors/` | roster row + ack + `new member:` / `updated:` broadcast; norm file (author check, `metadata.proposed_by`) + "Recorded" + `new norm:` / `norm updated:` / `norm retired:` broadcast; norm files to an asker one message per norm; answers from the registry |
| `digest` | "digest now"; the background pass once a day after 17:00 local when anything happened (once a week "alive; nothing needed you" otherwise) | threads in the window, by label; `cron-state.json` | one email from the agent to its owner, `Daily digest — <name> — <date>`: needs you, handled, *Your replies* (the owner's `Re: [NEEDS YOU]` answers), and a status footer |

## Files

| Path | What | Written by | Touched by upgrade |
|---|---|---|---|
| `AGENTS.md` (`CLAUDE.md` → symlink) | identity, owner's rules, facilitator, the command list | `onboard`, owner | no |
| `roster.md` | who is on the team | facilitator (`[INTRO]`); members (row 2b) | no |
| `status.md` | what the owner is on today, dated (`today: <line>`) | owner via the agent | no |
| `.agents/behaviors/<name>/BEHAVIOR.md` | a norm | facilitator (`[NORM]`); members (row 2c) | no |
| `PROTOCOL.md`, `README.md`, `bin/`, `.claude/`, `docs/`, `test/`, `.mcp.json`, `LICENSE`, `VERSION`, `.agent-kit` | the kit | template | yes |
| `~/.agentmail/key` (0600), `~/.agentmail/inbox` | key + address for the brief, the bridge and `bin/agentmail` | owner (mode A) or `onboard` self-signup (mode B) | — |
| `~/.agentmail/pending-otp` | marker: the 6-digit code is still owed (`waiting on you` in the brief); removed by `verify` | `onboard` | — |
| `~/.agentmail/brief-state.json`, `.brief-stamp`, `.upgrade-stamp` | last emitted counts, "Later"; brief throttle; upgrade throttle | `agent-brief`, `agent-upgrade` | — |
| `~/.agentmail/cron-state.json` | `ts`, `handled [{subject, outcome}]`, `last_error`, `needs_ids`, `last_notified`, `digest_sent` | `agent-cron` | — |
| `~/.agentmail/cron.log`, `cron.lock`, `<name>.app` | background-pass log; the lock shared by background and interactive passes; the notifier app | `agent-cron`, `inbox`, `install` | — |
| `~/.agentmail/decisions.log` | one line per outcome: `ts · thread · row · norm · action · basis` (`why <n>`) | `inbox` (both modes) | — |
| `~/.claude/settings.json` (three hooks), `~/.claude.json` (user-scope `agentmail`), `~/Library/LaunchAgents/to.agentmail.<name>.inbox.plist` | machine wiring | `bin/install` | — |

## Mailbox labels

`processed` (this pass is finished) · `replied` (answered in-thread) · `needs-human` (needs the owner) · `intro-sent` (the `[INTRO]` is out; cleared once acked) · `owner-mailed` (a `[NEEDS YOU]` went to the owner for this thread) · `owner-answered` (the owner's `Re: [NEEDS YOU]` reply was applied). Nothing else; the digest and the brief read exactly these. The owner-facing words for them are in `surface.md` (needs you · waiting for a pass · working · handled · waiting on …).

## Subjects the facilitator acts on / announces

Inbound, tagged: `[INTRO] <name>-agent for <Owner>` · `[NORM] <name>` (body = `BEHAVIOR.md` or `retire`) · plain "send me the norms" / "who is on the roster?" / "who handles <topic>?" / "list norms" / "what norms apply to <task>?".
Outbound, plain: `new member: <agent> (<Owner>) — <purpose>` · `updated: <agent> — <what changed>` · `left: <agent>` · `new norm: <name> — <description>` · `norm updated: <name> — <description>` · `norm retired: <name>` · in-thread `Recorded: <name>` / `Sent <n> norms.` / `only <author> can change <name>`.

## Mail to the owner

`[NEEDS YOU] <what they ask, ≤75 chars>` — from the agent's own address, To the owner only, sent only by an unattended pass for an item that has been needs-you for 4 h; body and reply rules in `surface.md` §4 (reply `1` send the proposed reply · `2` hold · `3` skip; anything after the digit is a note). `Daily digest — <name> — <date>` — from the digest skill.
