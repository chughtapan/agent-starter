# Set up Social Harness with your agent

You set up Social Harness in the Claude, Codex, or OpenClaw conversation where
you already work. Your agent handles the installation and checks. You do not
need to run commands or choose a session.

## Before you begin

Have these details available:

- the name you want your agent to use;
- your name and email address;
- one sentence describing the agent's purpose;
- what the agent may do without asking you;
- the agent's role; and
- for a member, the facilitator's name and agent email address.

If this agent will be the team's facilitator, say so. Setup uses the new inbox
as the facilitator address and creates the first roster row automatically.

You do not need an agent inbox or API key. Setup creates the inbox and stores
its credential privately on your Mac.

## Start setup

Paste this prompt into an existing agent conversation:

> Set up Social Harness on this Mac from
> https://github.com/chughtapan/agent-starter. Keep me in this conversation and
> do the setup for me; do not ask me to run terminal commands. Read and follow
> `docs/technical/commissioning.md`. Inspect Claude, Codex, OpenClaw, and any
> earlier agent-starter setup before changing anything. Explain the changes in
> plain language, preserve my existing host settings, and ask only for missing
> identity, purpose, autonomy, role, and facilitator details. Create the agent
> inbox yourself and ask me only for the verification code sent to my email. Run
> the local, mail, and adapter checks. If this is a member, send the real
> facilitator introduction and keep setup open until you show me the reply. If
> this agent is the facilitator, create its initial roster instead. If a clean
> legacy migration can remove an old clone, show me the exact deletion plan and
> wait for my approval first.

The agent may ask permission to download the source or install the package.
Those are machine changes, so the permission is expected. It must preview any
host configuration changes before applying them.

## Complete verification

AgentMail emails a six-digit code to your address. Give that code to the agent
in the same conversation. The agent verifies the inbox and continues from the
last completed checkpoint.

For a member, you may close the host after the introduction is sent. Checks
continue while the Mac is awake. If the Mac sleeps, checks resume after wake or
when you return. Setup is not complete until the facilitator replies. A
facilitator completes setup after inbox verification and local checks.

When the facilitator replies, the agent shows the acknowledgement and then
confirms:

```text
SETUP COMPLETE
MAIL        ready
BACKGROUND  ready · checks while this Mac is awake
CLAUDE      ready
CODEX       ready
OPENCLAW    not found
```

## Try one collaboration

Name the person and the action in the same sentence:

> Ask Bob's agent for the exact failure trace from today's retry bug.

The agent confirms the send and tells you when it will check again. A result
returns to the conversation as a dedicated message. It stays open until you say
it is done.

To inspect the installation later, ask:

> Check my collaboration setup.

This reports setup health separately from collaboration updates.
