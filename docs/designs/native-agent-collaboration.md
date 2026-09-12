# Design: Native Collaboration for Existing Agents

Research record from 2026-08-26.

> This document captures the exploration that informed the current product. For
> current requirements, see [the PRD](../product/PRD.md) and
> [experience contract](../product/experience-contract.md).

## Problem Statement

People already have agents they use in Claude, Codex, or OpenClaw. Those agents
are useful individually but isolated from their teammates' agents. They lack a
dependable way to discover one another, coordinate under team rules, preserve
handoffs, and bring outcomes back to their owners in the environment each owner
already uses.

The current kit proves several collaboration primitives—agent identity, an
inbox, a roster, norms, owner escalation, and a facilitator—but its product
shape is still too coupled to a repo, Claude-specific machine wiring, and
operational concepts users should not have to understand. Its onboarding can
finish before the user has confidence that a real collaboration round trip
works. Its current status surface primarily diagnoses installation, while users
need a distinct way to inspect updates from other agents without hijacking the
coding harness's general status.

Persistence and scheduling are enabling capabilities, not the product. The
product is a collaboration layer for agents people already use.

## What Makes This Cool

A person can remain in Codex while a teammate remains in Claude and say:

> Ask Bob's agent whether anything is blocked on me.

Their existing agents coordinate directly, under each owner's skills and
autonomy contract, and report the outcome in each person's native environment.
The same machinery can be invoked explicitly or by an ambient routine. Nobody
adopts a shared dashboard, moves into a new chat product, or learns the
transport underneath.

## Demand and Product Evidence

- Internal teammates completed onboarding but then did not know when or where an
  answer would return, or whether the agent session had to remain open.
- A real agent-to-agent question about a teammate's day required a holding
  reply, owner input, and a later answer. The underlying coordination was
  valuable; its lifecycle was unclear.
- The facilitator successfully distributed norms, showing that team-level
  collaboration policy can travel independently of application behavior.
- Another external person recognized the problem and is willing to try the
  product; exact use cases and failure traces are pending. This is qualified
  interest, not yet proof of demand.
- The original v0.1 handoff already contained the strongest onboarding idea: one
  prompt handed to an existing agent, visible/resumable handoffs, and a first
  real exchange. The redesign restores and hardens that approach rather than
  replacing it with a conventional installer.

## What Already Exists

- One-prompt onboarding and an agent-operated installer.
- Agent identity, owner binding, facilitator, roster, norms, and autonomy
  concepts.
- AgentMail transport, thread labels, decision logs, and idempotent
  message-handling primitives.
- Session-start hooks, a brief, background-pass concepts, notifications, and
  installation health checks.
- Claude, Codex, and OpenClaw execution and scheduling surfaces that can become
  adapters.
- A strong protocol trust boundary: mail is data, roster membership governs
  autonomous replies, agents identify themselves, and secrets block sends.

The implementation should migrate and harden these primitives rather than
replace them wholesale.

## Constraints

- Internal use comes first; the next external user receives the same product,
  not a bespoke fork.
- Claude, Codex, and OpenClaw remain the user-facing environments.
- There is no new dashboard, task manager, or mandatory collaboration app.
- Onboarding begins with one prompt to the user's existing agent. A person is
  never expected to operate a setup CLI.
- The onboarding agent owns inspection, installation, repair, and live smoke
  testing on that machine.
- Setup is not complete until the facilitator handshake succeeds: the
  introduction is received, the roster comes back, and the response is surfaced
  in the original host.
- Application-specific behaviors remain skills. Authority remains configurable
  through skills and autonomy contracts and is explicitly deferred from this
  design.
- The team maintains the roster and facilitator relationship.
- Transport, scheduler, and model provider are adapters. AgentMail is the
  initial transport, not the product boundary.
- No implementation begins from this document until the design is approved.

## Premises

1. **Collaboration is the product.** Identity, persistence, background
   execution, delivery, and audit state exist to make collaboration dependable.
2. **Bring the agent the user already has.** The collaboration layer augments an
   existing Claude, Codex, or OpenClaw agent instead of asking the user to adopt
   a new primary agent interface.
3. **Native interaction, shared substrate.** Conversation, permission prompts,
   notifications, and review use host-native affordances. Identity, roster,
   collaboration state, routine intent, and policy references remain consistent
   beneath those hosts.
4. **Delegated and ambient work are one loop.** A human request or a routine may
   initiate collaboration; both flow through the same roster, transport, policy
   check, handoff, and reporting path.
5. **Routine definitions are portable; execution is delegated.** A routine's
   intent belongs to the collaboration layer. Claude cloud or Desktop schedules,
   Codex Automations, OpenClaw automations, or a local fallback may execute it.
   Claude already exposes cloud, Desktop, and session-bound scheduling with
   distinct runtime semantics; Codex exposes scheduled Automations; OpenClaw
   exposes a persistent Gateway scheduler. See
   [Claude scheduled tasks](https://code.claude.com/docs/en/scheduled-tasks),
   [Codex Automations](https://openai.com/index/introducing-the-codex-app/), and
   [OpenClaw automations](https://docs.openclaw.ai/automation/cron-jobs).
6. **Conversation handles work; a compact board handles updates.** The user can
   ask about updates from other agents, inspect one collaboration
   conversationally, and separately diagnose setup health.
7. **Onboarding is commissioning.** It is a resumable conversation with verified
   handoffs, not a fast sequence of configuration output.

## Approaches Considered

### Approach A: Repo-Native Kit — Minimal Viable

Summary: Continue installing the collaboration machinery separately inside each
agent repo and improve the existing skills, hooks, brief, and background pass.

- Effort: S
- Risk: Medium
- Pros: smallest change; reuses nearly all current code; easy to dogfood
  immediately.
- Cons: identity and state fragment across projects; machine wiring remains
  Claude-centric; routine portability and cross-host consistency stay awkward.
- Reuses: current `AGENTS.md`, onboarding skill, AgentMail bridge, roster,
  behaviors, install checks, and background pass.

Rejected as the destination because the repo would remain the accidental product
boundary.

### Approach B: User-Level Collaboration Runtime — Selected

Summary: Install one local control layer per agent identity, connect it to the
user's existing hosts, and delegate actual execution to available host-native or
local executors.

- Effort: M
- Risk: Medium
- Pros: stable identity and collaboration state across hosts; no new user-facing
  application; portable routines can reuse provider scheduling; clean path from
  internal dogfood to external installation.
- Cons: requires explicit host and executor adapters; cross-host result return
  has provider-specific limits; migration from repo-owned state must be
  deliberate.
- Reuses: AgentMail transport, roster/facilitator protocol, Agent Behavior
  skills, autonomy concepts, existing onboarding checkpoints, brief semantics,
  decision log, and most safety rules.

### Approach C: Hosted Collaboration Network — Ideal Long-Term Architecture

Summary: Move identity, roster, routing, routines, activity state, and always-on
coordination to a hosted service while hosts remain native clients.

- Effort: XL
- Risk: High
- Pros: strongest reliability and multi-device behavior; simpler cross-team
  discovery; no dependence on a user's machine being available.
- Cons: introduces accounts, hosting, privacy, authorization, billing, and
  operational trust before the internal interaction is proven.
- Reuses: protocol and policy concepts, but replaces much of the current local
  runtime.

Deferred until the local interaction model and demand are proven.

## Recommended Approach

Build Approach B as a **local collaboration control layer with host-native
interaction and pluggable execution**.

### System boundaries

```text
Claude / Codex / OpenClaw
  native conversation, approvals, notifications, result review
                    │
             host adapter
                    │
Local collaboration runtime
  identity binding · roster · session registry · activity ledger
  routine definitions · policy references · routing · health
          │                              │
   transport adapters             executor adapters
   AgentMail initially            Claude cloud/Desktop
                                  Codex Automations
                                  OpenClaw Gateway
                                  local fallback
```

The local runtime is a control layer. It does not need to execute every routine
or remain awake when an available provider can execute the routine reliably.

### Where things live

The exact product namespace remains a naming decision, but ownership is fixed:

| Concern                                 | Canonical owner                                                      | Notes                                                                                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent identity and owner binding        | user-level collaboration runtime                                     | One logical identity may be connected to multiple hosts.                                                                                                                |
| Host-specific instructions and context  | existing Claude, Codex, or OpenClaw environment                      | The product augments rather than relocates the user's agent.                                                                                                            |
| Connected session presence              | ephemeral runtime session registry, populated by host hooks          | Records native session reference, host, machine, project scope, recent owner activity, lifecycle evidence, and presentation capabilities. It is not a transcript store. |
| Roster and facilitator relationship     | team source, cached by the runtime                                   | The maintained roster is authoritative; local copies are inspectable caches.                                                                                            |
| Skills and autonomy contracts           | reviewable files, referenced by the runtime and projected into hosts | Their detailed redesign is deferred.                                                                                                                                    |
| Collaboration activity                  | durable local ledger                                                 | Powers status, resumption, deduplication, provenance, and failure recovery.                                                                                             |
| Portable routine definitions            | runtime                                                              | Stores trigger, skill, roster scope, policy reference, desired outcome, return path, and executor binding.                                                              |
| Provider routine IDs and run state      | executor adapter mapping                                             | Allows reconciliation without making provider state canonical.                                                                                                          |
| Transport credentials and other secrets | provider-specific user storage                                       | Never committed to an agent or product repo.                                                                                                                            |
| Product source and examples             | `agent-starter` repo                                                 | Not the canonical runtime state of an installed agent.                                                                                                                  |

The installed layout should be versioned and migratable. Repo-local files may
declare project-specific collaboration context, but must not fork the agent's
identity, roster, or activity ledger.

### Core collaboration record

Every delegated or ambient collaboration creates one durable record with:

- stable collaboration ID;
- initiating human, agent, skill, or routine;
- participants resolved through the roster;
- policy/autonomy-contract decision reference;
- current state and who owns the next move;
- last meaningful event, next intended action, and promised next update or
  check;
- originating host, native session reference, and desired return path;
- execution state, delivery state, and owner-attention state, tracked separately
  internally;
- complete provenance sufficient to show a collaboration or explain why an
  action occurred.

The internal state machine is:

```text
created → routing → coordinating → waiting-on-peer / needs-owner
        → outcome-ready → presented → acknowledged
        ↘ failed / cancelled
```

Retries and delivery failures must not replay an external side effect. A
finished collaboration whose result was not surfaced remains `outcome-ready`.
Rendering the result moves it to `presented`, not `acknowledged`; only an
explicit owner action closes it.

### Native interaction contract

The collaboration layer does not claim broad questions such as
`What are you working on?`, which may refer to the coding harness or the current
session. It activates only when the owner's intent crosses the agent-to-agent
boundary explicitly:

- the owner refers to another person's agent, for example
  `Ask Bob's agent whether Tuesday works`;
- the owner replies directly to a collaboration update;
- a configured routine initiates collaboration under its skill and autonomy
  contract; or
- the owner invokes a future product-named native skill.

A person's name alone is not enough to authorize a send. When the other-agent
action or recipient is ambiguous, the agent confirms the boundary before causing
an external side effect. A portable prefix such as `team:`, `coordinate:`, or
`collab:` is not part of the interaction contract. The eventual product-named
skill may provide a host-native explicit escape hatch after naming is settled.

**Conversation is the work surface; the board is an update surface.** Owners
delegate, clarify, review, and redirect work through ordinary conversation with
the agent they already use. The compact board and modeline only summarize
collaboration state and draw attention to a change. They do not become forms,
command palettes, task cards, or a second place where work must be managed.

The runtime supports semantic intents expressed in ordinary language:

- `Anything from the other agents?` — what needs the owner, is working, is
  waiting, or is ready;
- `Show the Bob request` — one collaboration's participants, timeline, current
  owner, next action, trigger, policy basis, executor, and return path;
- `Why did you send that?` — the incoming evidence and skill/autonomy decision
  that caused an action or escalation;
- `Check the collaboration setup` — installation, transport, executor,
  notification, and live-test health;
- `Continue collaboration setup` — resume the first incomplete onboarding
  checkpoint;
- `Cancel the request to Bob` — stop future work when safe and explain any
  action that already occurred.

The update summary must not dump wiring diagnostics. Its default answer is
concise and ordered:

1. needs you;
2. working;
3. waiting on someone;
4. scheduled ambient routines;
5. open outcomes;
6. recent acknowledged outcomes and failures, on request.

#### Capability-adaptive collaboration surface

Every host renders the same collaboration state and terminology through the best
native surface it supports. Visual sameness is not a requirement; semantic
consistency is.

| Host capability                                                                      | Primary presentation                                                                          | Transcript behavior                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Arbitrary persistent status chrome, such as Claude Code's command-backed status line | A compact, locally rendered collaboration modeline that can refresh while the session is idle | Show details only when the owner asks or a meaningful state change needs attention                         |
| Fixed host-defined status chrome, such as Codex's selectable built-in status fields  | A compact brief when a session starts or resumes                                              | Refresh at quiet turn boundaries for meaningful changes or stale state; never interrupt an active response |
| Native messaging and notification surfaces, such as OpenClaw channels                | A compact native message or notification                                                      | Preserve detail in the channel history and expose the same inspection intents                              |

Claude's modeline command must read a cheap local snapshot; it must not perform
network work on each refresh. Codex's built-in status line may continue to show
Codex-owned session fields, but the adapter must not overload fields such as
task progress with unrelated collaboration state. If a host later adds arbitrary
status providers, its adapter can adopt the persistent modeline without changing
the runtime schema.

On hosts without arbitrary persistent chrome, a connected session renders the
current collaboration brief before ordinary work continues when it starts or
resumes. During an active session, the adapter renders an update when
collaboration state changes meaningfully. If work remains active and its
promised next update passes without a meaningful event, it renders a liveness
refresh at the next quiet turn boundary. It never repeats an unchanged brief on
every prompt or tool call and never interrupts an active response.

#### Session awareness and result claiming

Host adapters install lifecycle hooks during onboarding. Each connected session
registers a native session reference, host and machine, project scope, start
time, recent owner interaction, available presentation surfaces, and lifecycle
evidence with the local runtime. Evidence must remain qualified: a hook may
prove that a session started or that an owner submitted a turn without proving
that the terminal is currently foregrounded. Stale registrations expire instead
of being presented as live.

The registry is routing infrastructure, not a user-facing session manager. The
default board never lists open terminals, session counts, or generic coding
activity. Session information appears only when it resolves a collaboration
question—for example, where a result was delivered—or while checking
collaboration setup and diagnosing adapter registration. `WORKING` always means
active collaboration records, not every agent process on the machine.

This follows the useful mechanism demonstrated by
[Herdr](https://herdr.dev/docs/agents/) and
[Orca](https://www.onorca.dev/docs/model/agents-sessions)—agent hooks and
terminal lifecycle signals—but preserves a different product boundary. The
collaboration layer does not require users to launch sessions inside a new
terminal multiplexer or IDE, does not take control of their PTYs, and does not
scan arbitrary processes in order to guess at unregistered sessions. Sessions
opened before adapter installation, unsupported cloud sessions, and disconnected
machines are reported as unknown rather than inferred.

Result routing separates availability from delivery:

1. An explicit destination always wins; otherwise the originating native session
   is preferred.
2. When an outcome becomes ready, every eligible registered surface may show a
   scoped `RESULT READY` count without duplicating the result body.
3. The origin receives the full result conversationally at a safe host boundary.
   If it is unavailable, another session claims the result when the owner
   explicitly opens or asks for it.
4. Claiming uses an atomic lease so only one surface auto-renders the result.
   Other surfaces show where and when it was presented. The owner may still
   explicitly ask to see it again elsewhere.
5. A host adapter confirms presentation after it renders the result.
   Presentation, notification, scrolling, and subsequent unrelated conversation
   never mark the collaboration done.
6. The primary board retains the item as `READY` until the owner explicitly
   acknowledges or resolves it in conversation. Natural language such as
   `done with the Bob result`, `got it`, or supplying the requested decision
   counts when its target is unambiguous; otherwise the agent asks which item
   the owner means.

Automatic result presentation uses a dedicated conversational message. It waits
for a safe host boundary, begins with a plain source-oriented heading, leads
with the outcome, and is never appended to an unrelated answer. Attribution must
distinguish another agent's report from confirmed human input:

```text
Update from Bob's agent

Tuesday works. The migration must finish before the support rotation changes.
```

The interface may say `Bob confirmed Tuesday` only when the provenance shows
that Bob supplied that answer, rather than the other agent inferring or acting
under its standing authority.

The board may announce that this update is ready, but it never contains or
replaces the substantive result.

This is **notify broadly, deliver once, prefer the origin, allow explicit
rerouting**. Project or privacy scope can reduce broad availability to a generic
count or suppress it entirely.

The default presentation is the **compact board**:

```text
UPDATES                                      updated 9:08

NEEDS YOU   1  Bob — choose rollout window
WORKING     2  failure traces · morning brief
WAITING     1  Arvind — review requested 42m ago
READY       1  tester summary · open
```

The header has no global `online`, `available`, or presence indicator. Those
labels collapse several different truths—the host session, local runtime,
transport, machine, and background executor—and can imply that work will
continue when it will not. Each collaboration states its own execution and
return conditions; infrastructure health appears only when the owner asks to
check collaboration setup.

The board also distinguishes progress from observation. `updated 9:08` means a
collaboration had a meaningful state change at that time. A liveness refresh
must not advance that timestamp merely because the runtime rendered or checked
the same data. When the configured staleness threshold is crossed, the compact
board changes its language:

```text
UPDATES                        no change 42m · checked 9:08

WAITING     1  Bob — review requested · next check 9:30
```

`checked` proves only that the runtime observed the current state. `next check`
appears only when a real check, retry, or routine is scheduled; the interface
never invents future activity to sound reassuring.

There is no universal "stale after N minutes" rule. Every asynchronous
acknowledgement records and states a promised next update or check. The
collaboration becomes stale when that promise passes without a meaningful event.
Skills, routines, and autonomy contracts determine an appropriate promise for
the work; the core makes it visible, schedules the observation when required,
and detects a missed promise.

`NEEDS YOU` means the collaboration cannot proceed without an owner decision or
action. `READY` means an outcome has arrived and remains open for the owner; it
may already have been presented conversationally. Only explicit acknowledgement
or resolution removes it from the primary board and moves it to recent history.
`DONE` is not a primary-board state and is never inferred from display activity.

Two other supported profiles use the same state:

- **Focus strip:** one status line plus the highest-priority action; asking
  whether anything arrived from the other agents expands the board.
- **Full workboard:** expanded needs-you, working, waiting, ready,
  recently-acknowledged, and routine sections with stable item numbers.

At session start or resume, an empty state is one truthful line rather than a
board of zeroes:

```text
UPDATES  nothing open · checked 9:08
```

After that first orientation it stays quiet until state changes. Renderers must
support wide, narrow, single-line, and ASCII-safe layouts. State words carry
meaning without color; descriptions truncate before state or source; full text
remains available conversationally. Times use the owner's local timezone and add
a date when the event is not from today. No renderer relies on animation, emoji,
cursor position, or continuously changing countdowns.

During onboarding, the agent installs the compact board in the best surface
available in that host and smoke-tests it with the live handshake data. It does
not ask the owner to choose a presentation before they have used the product.
After commissioning succeeds, it mentions once that the owner can later say
`show the full workboard` or `only show what needs me`. Presentation remains
configurable per agent and may be overridden per host; underlying collaboration
state and terminology never change.

Continuity is configured once during onboarding, not renegotiated in every
handoff. When the host offers an approved cloud routine or another executor that
survives the interactive session and local machine, the adapter binds timed
follow-ups to it and verifies one real return. Otherwise the agent uses
resume-only continuity and promises to check only when the owner returns. The
default result waits inside the owner's agent; an external notification channel
such as email is an optional standing preference configured after the core
handshake works.

An asynchronous acknowledgement remains conversational. It states only what
resolves ambiguity: what the agent is doing, whether the interactive host may
close, who or what it is waiting on, and the one truthful update promise
supported by the configured continuity. It never presents conditional branches
about whether the laptop remains open. Return routing, session claiming, cloud
routines, and notification plumbing stay invisible unless delivery fails or the
owner asks. The board later summarizes the resulting state; it does not replace
the conversation with a structured receipt.

```text
I asked Bob's agent. You can close Codex. I'll check again at 10:00,
and the update will be waiting when you return.
```

Without verified background continuity, the promise becomes:

```text
I asked Bob's agent. You can close Codex. I'll check when you return.
```

## Agent-Led Onboarding

### Entry handoff

An existing teammate asks their agent to `invite <name>`. It produces one
self-contained prompt with the facilitator already filled in. The new user
pastes it into the Claude, Codex, or OpenClaw agent they already use.

The prompt asks that agent to:

- use the existing agent and environment;
- read the onboarding skill;
- explain and perform setup itself;
- ask only for human facts or consequential choices;
- checkpoint after every handoff;
- run live tests and repair failures;
- remain in onboarding until the team handshake succeeds.

### Commissioning stages

1. **Orient.** Explain the collaboration outcome, the stages, what may request
   permission, and how to resume. Make no changes yet.
2. **Understand the agent.** Detect the host and existing instructions. Ask
   conversationally for the agent's name and collaboration purpose; confirm
   owner and facilitator. Do not ask users to choose infrastructure.
3. **Inspect the machine.** Detect available host integrations, transports,
   notification paths, and routine executors. Prefer a host cloud routine for
   background continuity when it is available and can be configured with
   informed permission; otherwise select resume-only continuity. Describe only
   the resulting behavior in plain language.
4. **Configure one boundary at a time.** Immediately before each permission or
   external registration, explain what will change and why. The agent operates
   underlying commands and APIs.
5. **Run local smoke tests.** Verify identity binding, host adapter invocation,
   runtime health, transport send/receive, activity-ledger updates, and result
   surfacing. If background continuity is configured, run a near-term one-shot
   cloud routine with the interactive host closed and verify its return.
6. **Perform the live team handshake.** Send the introduction to the
   facilitator, receive the acknowledgment and authoritative roster, and surface
   the response inside the originating host.
7. **Teach inspection through use.** Render and smoke-test the compact board
   with the live handshake data. The onboarding agent runs the technical health
   checks itself, then asks the owner to try one explicit question such as
   `Anything from the other agents?` and answers it from the collaboration
   ledger. Mention optional setup details and presentation customization only
   after commissioning succeeds. This is part of commissioning, not
   documentation left for later.
8. **Finish honestly.** State whether timed updates continue with the host and
   machine closed, where results wait by default, and what remains optional.
   Offer an external notification preference such as email, additional sources,
   or application-specific skills only after the collaboration loop works.

### Resumption and waiting

Every stage begins with its check and writes a checkpoint. Repeating the
onboarding prompt or asking to continue collaboration setup resumes at the first
incomplete stage without replaying registration, messages, or permissions.

While waiting for the facilitator, the agent says exactly who owns the next move
and how the user will hear back. The state remains onboarding, not failed and
not complete. A missing or incorrect prerequisite produces one specific
diagnosis and a safe retry path.

### Completion gate

The done state requires all of the following:

- local health checks pass;
- a collaboration message left the new agent;
- the facilitator received and acknowledged it;
- the authoritative roster returned;
- the new agent stored the roster and surfaced the acknowledgment in the
  original host;
- the user asked whether anything arrived from the other agents and received a
  truthful summary backed by the handshake record.

The onboarding transcript itself is the interface and audit trail.

## Core User Walkthroughs

### Delegated coordination

```text
Owner, in Codex:
Ask Bob's agent whether anything is blocked on me.

Agent:
I'll ask Bob's agent. You can close Codex. I'll check again at 10:00,
and the update will be waiting when you return.
```

The runtime resolves Bob through the roster, checks the applicable skill and
autonomy contract, sends the handoff, and records who owns the next move. Bob
continues in his chosen host. The outcome is retained by the collaboration layer
and surfaced through a connected native host.

### Ambient coordination

```text
Owner, in Claude:
Every weekday morning, check whether anyone on my roster is blocked on me.
Only interrupt me when I can take a concrete action.

Agent:
I'll create a collaboration routine with those instructions.
It will run using Claude cloud, coordinate with agents on your roster, and
return actionable items here. Create it?
```

The runtime stores a portable routine and binds it to the selected executor. The
executor may change later without rewriting the collaboration intent.

### Inspection

```text
Owner: Anything from the other agents?

Agent:
Needs you
• Choose a rollout window for Bob

Working
• Gathering failure traces from the external tester

Waiting
• Arvind's agent — review response requested 42 minutes ago

Routines
• Morning blocker check — next run tomorrow at 9:00 AM
```

`Show the Arvind request` returns its event timeline, who owns the next move,
and when the agent will act next. `Check the collaboration setup` separately
returns infrastructure health and the timestamp of the last successful live
test.

## Failure Model and Hardening Priorities

1. **Half-onboarded machine.** Checkpoints and idempotent steps prevent repeated
   registrations or sends. The native host always shows the first incomplete
   stage.
2. **Facilitator does not acknowledge.** Onboarding remains visibly waiting,
   warns after a defined threshold, verifies the address, and offers a safe
   resend only after deduplication checks.
3. **Host or machine closes.** Verified background continuity keeps the promised
   check using its cloud or always-on executor. Resume-only continuity makes no
   clock-time promise and checks when the owner returns. The collaboration
   remains inspectable; an outcome stays ready until an eligible session claims
   and acknowledges it.
4. **Executor is unavailable.** The routine stays defined but reports
   `not scheduled` with the exact missing capability; the runtime may bind a
   compatible fallback only under the owner's configuration.
5. **Work completes but return delivery fails or is overlooked.** Execution,
   presentation, and owner acknowledgement are reconciled independently. The
   result remains recoverable and retryable without repeating the collaboration,
   and stays `READY` until explicitly resolved.
6. **Duplicate ambient work.** Stable routine and collaboration IDs, provider
   bindings, and idempotency keys prevent repeated external messages.
7. **Cross-host inconsistency or duplicate delivery.** The runtime ledger is
   canonical; host adapters render it rather than maintaining independent
   collaboration state. Atomic result claims prevent multiple open sessions from
   consuming the same outcome.
8. **Unsafe or ambiguous authority.** The runtime records the skill and
   autonomy-contract decision and escalates through the native host. Detailed
   authority semantics remain deferred.
9. **Untrusted message instructions.** Mail and other transports remain data.
   The current protocol's trust boundary and secret scanning continue to apply.
10. **Status claims health while work is broken.** Health is based on live
    probes and reconciled run/delivery evidence, not merely installed files or
    process presence.
11. **Promised update is missed.** The item becomes visibly stale, retains the
    last truthful event, and reports the failed check or missing executor. A
    refresh never silently moves the promise forward.
12. **Background capability disappears after setup.** Revoked provider
    permission, a missing schedule, or executor drift invalidates future
    clock-time promises immediately. Active items keep their last truthful
    event, switch to resume-only behavior when safe, and tell the owner what
    changed instead of silently downgrading.

## NOT in Scope for the First Hardened Product

- A new chat application, dashboard, team room, or task manager.
- A hosted collaboration control plane.
- Replacing Claude, Codex, OpenClaw, or their schedulers.
- Finalizing the skill, autonomy-contract, or roster redesign.
- Building application-specific scheduling, review, meeting, or commitment
  workflows into the core.
- Connecting calendar, email, to-dos, or team boards before the first
  collaboration handshake works.
- Supporting arbitrary numbers of agents per owner before the default one-agent
  identity is reliable.

## Success Criteria

### Internal commissioning

- Two internal teammates complete onboarding from one pasted prompt in their
  existing hosts without manually invoking a setup CLI.
- Every onboarding step is resumable, and no registration, introduction, or
  routine is duplicated after interruption.
- Both machines complete the facilitator handshake and surface the returned
  roster in the originating host.
- Each machine passes live send, receive, activity-ledger, result-return, and
  configured-executor tests.
- Any configured background continuity passes a one-shot test while the
  originating interactive host is closed.
- Each owner can explicitly ask whether anything arrived from the other agents
  and receive the compact update summary without colliding with the coding
  harness's general status.
- The update summary remains understandable in wide, narrow, single-line,
  colorless, and ASCII-safe rendering tests.

### Collaboration proof

- One delegated coordination request completes across two different supported
  hosts.
- One ambient routine initiates coordination and returns an actionable outcome.
- In both cases, the acknowledgement gives one truthful continuity promise
  without asking the owner to reason about session, machine, and executor
  branches.
- Every asynchronous acknowledgement includes a truthful next-update promise; a
  deliberately missed promise becomes visibly stale without falsifying progress.
- A completed-but-undelivered outcome is recovered without repeating the
  external request.
- With three eligible sessions open, all show result availability, only one
  auto-renders the full result, and the others reconcile to its presentation
  location. The item remains `READY` everywhere until the owner explicitly
  resolves it.
- An automatically returned result appears as a dedicated conversational update
  rather than being appended to unrelated work.

### External adoption

- The interested external tester completes the same agent-led onboarding, with
  the onboarding agent retaining a complete failure trace.
- Any failure ends with a specific diagnosis, a saved checkpoint, and a
  successful resume after repair.
- The tester completes the team handshake before seeing a completion claim.
- The tester can inspect current work natively without learning repository
  paths, runtime processes, AgentMail labels, or scheduler-specific commands.

## Distribution Plan

- The human-facing artifact is a one-prompt invitation generated by an existing
  teammate's agent.
- The prompt points the receiving agent to a versioned, remotely readable
  onboarding skill and product source. The agent chooses the appropriate
  installation path for its host.
- GitHub releases remain the initial distribution mechanism for source, host
  adapters, migrations, and integrity metadata.
- Installation commands remain implementation details executed by the onboarding
  agent and may vary by host.
- Updates must preserve local identity, skills, autonomy contracts, roster
  cache, activity history, and routine bindings. Upgrade smoke tests use the
  same health and handshake primitives as onboarding.
- A hosted service is not required for the first hardened release; cloud
  provider routines may execute portable collaboration routines when configured.

## Open Questions

- Final product name and user-level storage namespace.
- Whether the first release formally supports one agent identity per owner or
  multiple named identities.
- Which hosts allow safe result rendering at an idle boundary versus requiring
  the owner's next turn; closed proprietary threads are never assumed writable.
- The lifecycle and presence signals each supported host exposes reliably,
  including cloud sessions and disconnected machines.
- How portable routine updates reconcile provider-specific schedule and
  permission constraints.
- The detailed skill, autonomy-contract, and roster redesign; explicitly
  deferred.
- When AgentMail should remain the default transport versus becoming one of
  several transports.
- Whether external onboarding uses the production facilitator or a dedicated
  deterministic commissioning agent.

## Next Steps

1. Convert the current onboarding flow into the commissioning state machine
   above, retaining the original one-prompt handoff and idempotent checks.
2. Define the user-level runtime schema: identity binding, roster cache, session
   registry, activity ledger, result claims, portable routines, host bindings,
   executor bindings, and migration version.
3. Define the native host contract for lifecycle registration, capability
   reporting, collaboration activation, inspection, provenance, setup health,
   resumption, result claims, and asynchronous acknowledgements.
4. Build one vertical slice across Codex and Claude: one prompt → local tests →
   facilitator handshake → native status inspection → delegated collaboration
   result.
5. Add one ambient routine using a provider executor, then verify it can be
   inspected and moved without changing its collaboration intent.
6. Run live commissioning on the two internal machines, repairing the product
   rather than hand-configuring around failures.
7. Give the external tester the same invitation prompt and retain their exact
   use case and failure trace as acceptance evidence.

## Implementation Tasks

Synthesized from the UX audit findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2d / CC: ~3h)** — Runtime state — Define the user-level
      collaboration schema and migrations
  - Surfaced by: Information Architecture and State Coverage — canonical
    ownership is clear, but identity, session presence, collaboration, delivery,
    acknowledgement, and executor binding need an executable schema.
  - Files: `docs/ARCHITECTURE.md`, `docs/reference.md`, `bin/agent-runtime`
    (new), migration tests (new)
  - Verify: create, migrate, resume, and inspect one collaboration without a
    repo-local identity fork.
- [ ] **T2 (P1, human: ~2d / CC: ~4h)** — Host adapters — Build a Claude/Codex
      capability conformance harness
  - Surfaced by: Cross-Host System — the design depends on different lifecycle,
    status-surface, and result-presentation capabilities in each host.
  - Files: `bin/install`, host hook scripts (new), `docs/codex.md`, conformance
    tests (new)
  - Verify: register session identity, owner activity, presentation capability,
    start/resume brief, and safe result boundary in both installed clients.
- [ ] **T3 (P1, human: ~2d / CC: ~4h)** — Commissioning — Convert onboarding
      into a resumable, idempotent state machine
  - Surfaced by: Cognitive Walkthrough — setup must not complete before local
    tests, the facilitator round trip, roster return, and user-visible proof all
    succeed.
  - Files: `.claude/skills/onboard/SKILL.md`, `bin/install`, `bin/agent-invite`,
    onboarding fixtures and tests (new)
  - Verify: interrupt after every stage, rerun the same prompt, and confirm no
    duplicate registration, introduction, permission, or routine.
- [ ] **T4 (P1, human: ~2d / CC: ~4h)** — Continuity — Bind and verify one
      cloud-backed follow-up executor
  - Surfaced by: Away Journey and Failure Coverage — clock-time promises require
    an executor that survives the interactive host and local machine.
  - Files: executor adapter (new), `bin/agent-cron`, `bin/install`, executor
    reconciliation tests (new)
  - Verify: schedule a near-term check, make the interactive host unavailable,
    prove the run and returned state, then revoke permission and verify visible
    downgrade.
- [ ] **T5 (P1, human: ~2d / CC: ~4h)** — Result delivery — Implement
      availability, claim, presentation, and explicit acknowledgement
  - Surfaced by: State Coverage — a result must auto-present once, remain
    `READY`, permit explicit re-open, and close only on unambiguous owner
    resolution.
  - Files: runtime ledger (new), host adapters (new), `bin/agent-brief`,
    delivery-state tests (new)
  - Verify: open three sessions, complete one result, confirm one automatic
    presentation, re-open it explicitly elsewhere, and acknowledge it once.
- [ ] **T6 (P1, human: ~1d / CC: ~2h)** — Update surface — Implement truthful
      wide, narrow, single-line, and ASCII renderers
  - Surfaced by: Visual System and Accessibility — the compact board cannot rely
    on fixed columns, color, Unicode, or animation.
  - Files: `bin/agent-brief`, `test/agent-brief.test.sh`, renderer fixtures
    (new), `docs/surface.md`
  - Verify: golden tests for empty, working, waiting, stale, needs-you, ready,
    narrow, colorless, and ASCII output.
- [ ] **T7 (P1, human: ~1d / CC: ~2h)** — Trust boundary — Enforce activation
      and provenance semantics
  - Surfaced by: Information Architecture and Trust — general harness prompts
    must not send externally, and another agent's response must not be
    attributed to its human owner without evidence.
  - Files: `AGENTS.md`, `PROTOCOL.md`, `.claude/skills/inbox/SKILL.md`, behavior
    tests (new)
  - Verify: ambiguous person mentions cause no send; explicit other-agent
    requests do; rendered results retain agent/human provenance.
- [ ] **T8 (P1, human: ~2d / CC: ~4h)** — Upgrade safety — Migrate repo-owned
      state and remove stale hooks without losing identity
  - Surfaced by: Failure Coverage — old and new adapters running together can
    duplicate delivery, while version-only upgrades previously missed drift.
  - Files: `bin/agent-upgrade`, `bin/install`, `VERSION`, migration and
    uninstall tests (new)
  - Verify: upgrade a dirty v0.3.x dogfood install, preserve
    identity/roster/norms/history/routines, remove obsolete hooks, and prove one
    active adapter per host.
- [ ] **T9 (P1, human: ~1d / CC: ~2h)** — Internal proof — Run the complete
      Claude-to-Codex vertical slice on two real machines
  - Surfaced by: Journey Coverage — architecture is not proven until the real
    onboarding, continuity, handoff, return, acknowledgement, and stale-promise
    loop works.
  - Files: test runbook (new), retained failure traces, `docs/reference.md`
  - Verify: satisfy every Internal Commissioning and Collaboration Proof
    criterion, including one deliberately missed promise.
- [ ] **T10 (P2, human: ~4h / CC: ~1h)** — External learning — Commission the
      interested tester with the unchanged product
  - Surfaced by: Stakeholder Read — qualified interest becomes evidence only
    after an independent user completes the same path.
  - Files: external commissioning runbook (new), anonymized failure trace,
    user-story updates
  - Verify: tester completes the handshake and first collaboration without
    developer-operated CLI steps or bespoke configuration.

## Design Review Completion Summary

```text
+====================================================================+
|         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | No DESIGN.md; interaction inside host UIs   |
| Step 0               | 5/10; interaction boundary and truth model  |
| Pass 1  (Info Arch)  | 5/10 → 7/10                                |
| Pass 2  (States)     | 4/10 → 8/10                                |
| Pass 3  (Journey)    | 5/10 → 8/10                                |
| Pass 4  (AI Slop)    | 5/10 → 8/10                                |
| Pass 5  (Design Sys) | 5/10 → 7/10                                |
| Pass 6  (Responsive) | 3/10 → 6.5/10                              |
| Pass 7  (Decisions)  | 17 resolved, 5 intentionally deferred      |
+--------------------------------------------------------------------+
| NOT in scope         | written (7 items)                           |
| What already exists  | written                                    |
| TODOS.md updates     | 0; findings are tasks or open decisions     |
| Approved Mockups     | 0; no owned visual application surface      |
| Decisions made       | 17 added to plan                            |
| Decisions deferred   | 5 (listed in Open Questions)                |
| Overall design score | 5/10 → 7.5/10                               |
+====================================================================+
```

The plan is not yet design-complete at 8+: responsive host rendering and
provider-capability proof remain implementation-gating tasks. Run the
engineering plan review before implementation, then run a live design review
against the installed Claude and Codex surfaces.

## What I Noticed About How You Think

- You repeatedly moved the design back to the user boundary: "where does the
  user interact with the agent?" That prevented the runtime from becoming the
  product.
- You rejected both a dashboard and a persistence-centered framing. "Persistence
  is not really the goal. Collaboration is" is the decision that organizes the
  architecture.
- When the walkthrough became a CLI installer, you returned to the original
  handoff and required live smoke testing "until the setup works." That is a
  much stronger completion criterion than successful configuration output.
- You kept application norms out of the core while preserving delegated and
  ambient collaboration. That leaves the shell opinionated about coordination
  mechanics without hard-coding what a team should coordinate about.

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                             | Runs | Status             | Findings                                                              |
| ------------- | --------------------- | ------------------------------- | ---- | ------------------ | --------------------------------------------------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope & strategy                | 0    | —                  | Not run                                                               |
| Codex Review  | `/codex review`       | Independent 2nd opinion         | 0    | —                  | Not run for this plan                                                 |
| Eng Review    | `/plan-eng-review`    | Architecture & tests (required) | 4    | CLEAR (PLAN)       | Latest project review: 11 issues, 0 critical gaps; predates this plan |
| Design Review | `/plan-design-review` | UI/UX gaps                      | 2    | ISSUES OPEN (FULL) | Current score: 5/10 → 7.5/10, 17 decisions                            |
| DX Review     | `/plan-devex-review`  | Developer experience gaps       | 0    | —                  | Not run                                                               |

**VERDICT:** DESIGN REVIEW COMPLETE WITH ISSUES OPEN — run `/plan-eng-review`
against this plan before implementation; prove responsive rendering and provider
capabilities in the vertical slice.

**UNRESOLVED DECISIONS:**

- Product name and product-named native skill namespace.
- Whether the first release supports one agent identity per owner or multiple
  named identities.
- Detailed skill, autonomy-contract, and roster governance semantics.
- When AgentMail remains the default transport versus becoming one adapter among
  several.
- Whether external onboarding uses the production facilitator or a deterministic
  commissioning facilitator.
