# Product requirements: Social Harness v0.4

- Status: Internal vertical slice
- Owner: Product and engineering
- Last updated: 2026-08-27

## Summary

Social Harness adds dependable collaboration to the Claude, Codex, and OpenClaw
agents people already use. Conversation remains the work surface. A compact
board restores awareness of collaboration updates without exposing sessions,
transport, schedulers, or internal state.

The first release proves the user interface and lifecycle locally. It avoids
cloud execution and application-specific autonomy design until feedback shows
that the interaction is useful and understandable.

## Problem

People can ask an existing agent to contact a teammate’s agent, but they do not
know whether the request was accepted, whether they must keep a session open,
where the result will appear, or when the work is actually complete. The earlier
kit demonstrated identity, roster, norms, transport, and a background pass, but
coupled them to a repository and Claude-specific wiring.

The product must make collaboration legible without asking users to adopt a new
chat application, operate an installer, or manage agent sessions.

## Users

The first users are internal teammates with ordinary single-machine Claude,
Codex, or OpenClaw setups. The first external pilot is a person who has already
recognized the problem and will provide exact use cases and failure traces.

## Goals

1. A user can commission Social Harness by giving one prompt to an existing
   agent.
2. A user understands where collaboration happens, when a result will appear,
   and whether the machine must remain awake.
3. Updates are visible on session start or resume, when they change, and after a
   quiet interval, without taking over the conversation.
4. Results remain open until the user explicitly marks them done.
5. Claude, Codex, and OpenClaw use one underlying collaboration state and one
   local poller.
6. Migration removes the old product-owned wiring without leaving duplicate
   hooks, skills, pollers, state, or a dedicated clone.

## Non-goals

- A new chat application, shared room, terminal manager, or dashboard app
- A user-facing session list or automatic session selection
- Cloud or always-on execution
- Application-specific meeting, travel, review, calendar, or handoff norms
- Final autonomy-contract, roster-governance, or multi-identity design
- A hosted control plane, accounts, billing, or cross-company discovery
- Git as required runtime state

## Experience requirements

### Interaction boundary

The product activates only when one of these is true:

- the owner names a person or agent and requests an action;
- the owner replies to a collaboration item;
- the owner explicitly invokes the Social Harness skill; or
- a configured routine runs.

Generic phrases such as “status,” “queue,” “team,” and “what are you working
on?” must not activate Social Harness by themselves.

### Update board

The compact board is the default. It contains state, collaborator, short
summary, and age when useful. It contains no substantive result and no session
inventory. It appears:

- at session start or resume;
- when the open update set or state changes; and
- when the last presentation is older than the configured stale interval.

The default stale interval is one hour. Narrow, ASCII-safe, and detailed
profiles remain configuration options; compact is the release gate.

### Results and completion

A result arrives as a dedicated collaboration message with the outcome first and
source named accurately. Presentation adds `sh-presented`; it never adds
`sh-done` or clears unread state. Completion is explicit:

- one open item and “done”: complete that item;
- several open items and “done”: ask which item;
- “done with everything”: complete every open item.

A new inbound message after completion reopens the collaboration.

### Continuity

The local background routine runs at the configured poll interval while the Mac
is awake. It pauses during sleep and checks again after wake. The user may close
Claude, Codex, or OpenClaw; they do not need to keep a session open. The machine
must remain awake for local checks. Cloud continuity is deferred and must not be
implied.

### Onboarding

The user gives one prompt to an existing agent. The agent inspects the machine,
collects missing identity and facilitator information conversationally, creates
the agent inbox, and asks the owner only for the emailed verification code. The
agent never asks the owner to choose an inbox address, supply an API key, or
configure the transport. It explains each permission boundary, installs only
detected compatible adapters, runs live local and mail smoke tests, sends a real
introduction, waits for the facilitator response, and presents the result in the
original host.

Onboarding is resumable. It is not complete until the facilitator
acknowledgement is surfaced. Optional display and behavior configuration comes
after success.

### Inspection

The owner can ask the agent to check collaboration setup. The agent reports
configuration, AgentMail access, local background routine, and each supported
host. Setup diagnostics do not appear in the normal update board.

## Data and state requirements

AgentMail is canonical for collaboration state. The release uses thread labels
`sh-collaboration`, `sh-waiting`, `sh-working`, and `sh-failed`, and message
labels `sh-needs-you`, `sh-ready`, `sh-triaged`, `sh-presented`, and `sh-done`.

Questions and results remain unread. Triage does not clear unread. Completion
adds `sh-done` and `read`, and removes `unread`, attention, and presentation
labels. No database is introduced.

The sender prefixes a new collaboration subject with `[COLLAB]`. This lets the
receiving runtime discover the thread and establish its local canonical labels;
the user-facing board does not show the transport prefix.

Installed user data lives under `~/.social-harness/`; secrets remain in
`~/.agentmail/`. Git export is optional and disabled by default.

## Host requirements

- Detect Claude, Codex, and OpenClaw during onboarding, migration, upgrade, and
  diagnosis.
- Install only detected adapters unless configuration explicitly enables or
  disables one.
- Add hooks and skills idempotently.
- Preserve all non-owned host configuration, including other products’ hooks.
- Use the current host as the default work surface; never ask the user to pick
  from sessions.
- Treat all three adapters as release gates for their supported v0.4 surface.

## Migration requirements

Migration is copy-first and all-or-blocked. It inspects the source clone, Git
state, known legacy artifacts, and unrelated files before mutation. It then
migrates identity, roster, status, and norms; installs and verifies the new
runtime; removes old hooks, skills, MCP wiring, poller, state, and labels; and
removes a dedicated clean clone only with explicit authorization.

It never deletes this product repository. Unrelated or uncommitted data blocks
the migration and is reported exactly.

## Release plan

1. v0.4 internal dogfood: complete one real round trip on each host and capture
   confusion and failure traces.
2. Feedback round: revise only the interaction contract and adapter behavior
   needed to address observed failures.
3. External pilot: use the same product and commissioning flow, with no bespoke
   fork.
4. v1 decision: evaluate evidence before expanding cloud routines, skills,
   autonomy, or architecture.

## Success measures

- Setup reaches a surfaced facilitator acknowledgement without the user
  operating a CLI.
- At least 90% of test users correctly answer where results appear and whether
  the host or machine must remain open after onboarding.
- Every result in dogfood remains visible until explicit completion.
- No user reports duplicate updates from multiple host pollers.
- Adapter installation produces no lost or overwritten non-owned configuration.
- The external pilot completes one useful collaboration and supplies its failure
  trace or confirms no failure.

## Open product questions

- Which compact-board fallback is clearest in narrow or non-Unicode terminals?
- Which natural-language phrases reliably distinguish explicit collaboration
  from ordinary harness questions?
- After the first feedback round, which cloud routine is worth testing first?
- What product name and skill namespace should external onboarding use?
