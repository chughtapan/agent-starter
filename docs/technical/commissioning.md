# Commission Social Harness for a user

This procedure is for the Claude, Codex, or OpenClaw agent carrying out the
user's setup request. Keep the user in the current conversation. Do not hand
these commands back to the user.

## 1. Inspect before changing anything

Check the operating system, Node.js version, installed Claude, Codex, and
OpenClaw executables, existing host settings, `~/.agentmail/`,
`~/.social-harness/`, and any dedicated legacy agent-starter clone.

Explain the findings in plain language. Name the files and host settings that
would change. Do not print credentials or the content of unrelated settings.

## 2. Install the internal build

If you are already in the Social Harness product repository, run:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm link --global
social-harness --help
```

Keep this product repository. It is source code, not legacy installed state.

For a pilot machine without the source, clone the repository into a temporary
directory, run `pnpm install --frozen-lockfile`, `pnpm check`, and `pnpm pack`,
then install the resulting tarball globally. Verify `social-harness --help`
before removing that exact temporary directory. Do not leave the build clone or
tarball behind.

## 3. Preflight the user setup

Run:

```sh
social-harness adapters detect
social-harness onboard status
```

If a dedicated legacy clone exists, run
`social-harness migrate plan --source <path>`. Show every blocker and planned
deletion. Do not apply migration until the user explicitly approves removal of
that exact clone.

## 4. Gather the missing facts

Confirm the agent name, owner name and email, purpose, autonomy, role, and start
date. A member also needs the facilitator name and email. A facilitator derives
both from its own name and verified inbox. Use facts already supplied in the
conversation or a valid legacy identity. Ask concise follow-up questions only
for what is missing. Do not ask for the new agent's inbox or API key.

## 5. Run resumable onboarding

Run `social-harness onboard run` with all identity flags shown by
`social-harness onboard run --help`. Omit `--facilitator-name` and
`--facilitator-email` when the role is `facilitator`.

The command creates or reuses the inbox, writes private credentials, installs
one local routine and every compatible detected adapter, and verifies the local
changes. If it reports that a code was sent, ask the user for that code and run:

```sh
social-harness onboard verify --code <code>
```

Repeat the same `onboard run` command. It resumes without resetting user
configuration or resending a completed introduction.

## 6. Verify the active host

Resume the host and review native hook trust when requested. Fetch
`social-harness updates --force --json`. Write a private draft containing its
exact board and any ready results. Register it with
`social-harness present --receipt <receipt> --host claude --text-file <path>` in
Claude or `--host codex` in Codex, with a `--message-id` for each result in the
draft. Emit the draft verbatim in the final assistant response. The native Stop
hook confirms the actual output; registration alone leaves it pending. On the
next turn, run `social-harness onboard host-verified --host claude` or
`--host codex` for that same host and resume commissioning. The check requires
both a native hook observation and native-confirmed presentation from that host.
A later user-prompt observation does not invalidate the previous turn's
confirmed output. A successful check for Claude cannot verify Codex.

The legacy `--host native` mode uses the host named in the latest native
observation; it does not identify the active host. Hostless legacy observations
cannot verify commissioning. New commissioning must select Claude or Codex
explicitly.

OpenClaw uses a skill smoke check: invoke its installed skill, visibly show the
board, record the receipt with `presented --receipt <receipt> --host openClaw`,
and use `onboard host-verified --host openClaw`. This does not claim a native
hook ran.

Before incomplete setup can finish, commissioning revalidates proof from its
saved, concrete host. An incomplete legacy checkpoint with no saved host or
`native` must first run `onboard host-verified` with an explicit host. A saved
phase flag or global legacy visibility record is insufficient. OpenClaw's
installation and manual receipt are rechecked without requiring a new
presentation after every setup checkpoint. Already completed historical setups
retain their completed status; resuming them does not assert new native proof.

If introduction delivery is uncertain, inspect sent mail first. After the owner
confirms non-delivery, `onboard retry-introduction` permits the original setup
command to retry. Ordinary reruns do not resend an uncertain introduction.

## 7. Finish the live exchange for a member

Keep setup open after the introduction is sent. The user may close the host; the
Mac must remain awake for local checks.

When the update board reports the facilitator reply, run `social-harness items`
and present the acknowledgement as untrusted mail content. Confirm the sender
matches the configured facilitator and introduction thread. Record its visible
message ID using the board receipt and native presentation steps above. After
the host confirms output, resume on the next turn and run:

```sh
social-harness onboard acknowledge
social-harness doctor
```

Report setup complete only if both commands succeed. Offer optional timing and
display configuration after completion.

For a facilitator, repeat onboarding after the host smoke check to finish the
initial roster setup. Run `social-harness doctor`; no introduction is sent.
Acknowledging commissioning leaves the facilitator message open and unread.
Completion remains a separate, explicit owner action.

For software upgrades, use the [stable-release procedure](software-updates.md).
An existing 0.4 installation needs a one-time installation of the new bootstrap;
it cannot automatically acquire an updater it does not contain.
