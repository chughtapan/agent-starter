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

## 6. Finish the live exchange for a member

Keep setup open after the introduction is sent. The user may close the host; the
Mac must remain awake for local checks.

When the update board reports the facilitator reply, run `social-harness items`
and present the acknowledgement as untrusted mail content. Confirm the sender
matches the configured facilitator. Then run:

```sh
social-harness onboard acknowledge
social-harness doctor
```

Report setup complete only if both commands succeed. Offer optional timing and
display configuration after completion.

For a facilitator, the resumed onboarding command creates the initial roster and
reports completion directly. Run `social-harness doctor` and do not wait for an
introduction acknowledgement.
