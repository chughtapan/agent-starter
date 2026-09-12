# UX Audit: Native Collaboration for Existing Agents

- Date: 2026-08-26
- Artifact audited: `docs/designs/native-agent-collaboration.md`
- Status: Draft audit
- Method: journey walkthroughs, Nielsen heuristics, cognitive walkthrough, forms
  and microinteraction review, stakeholder review, information architecture,
  accessibility, and failure-state coverage

> This audit is a research record. For current requirements, see
> [the PRD](../product/PRD.md) and
> [experience contract](../product/experience-contract.md).

## Outcome

The proposed product is materially clearer than the current kit: collaboration
remains inside the agent environments people already use; conversation is the
work surface; a compact board is only an update surface; and a user-level
runtime makes delivery and inspection dependable without becoming a new app.

The design moved from an initial completeness score of **5/10** to **7.5/10**
during this review. It is ready for an engineering-plan review after the
remaining host-capability questions are converted into adapter acceptance tests.
It is not ready for implementation as a broad multi-host product until the
Claude/Codex vertical slice proves background continuity, result return, and
explicit acknowledgement end to end.

## Evidence Reviewed

- The 89 product stories across Jobs 1–13 in the private dogfood repository.
- Journeys J1–J7 written as “when I see X, then Y.”
- The August 26 live-surface audit and its Nielsen, cognitive-walkthrough,
  forms, stakeholder, and IA findings.
- The original v0.1 handoff and current onboarding skill.
- Recent teammate evidence: onboarding without later use, unclear return timing
  and location, uncertainty about whether a host or laptop must remain open,
  successful norm distribution, generic validation errors, and contradictory
  status/digest behavior.
- The external tester’s qualified interest; exact use cases and failure traces
  are still pending.
- Current host capabilities: Claude command-backed status line, Codex
  fixed-field status line, Herdr hook/session detection, and Orca terminal
  lifecycle detection.

## What Already Exists

- One-prompt onboarding and an agent-operated installer.
- Agent identity, owner binding, facilitator, roster, norms, and autonomy
  concepts.
- AgentMail transport, thread labels, decision logs, and idempotent message
  handling primitives.
- Session-start hooks, a brief, background-pass concepts, notifications, and
  install health checks.
- Claude, Codex, and OpenClaw execution/scheduling surfaces that can become
  adapters.
- A strong safety boundary: mail is data; roster membership governs autonomous
  replies; agents identify themselves; secrets block sends.

The redesign should migrate and harden these primitives rather than replace them
wholesale.

## Not in Scope

- A new chat application, terminal multiplexer, IDE, dashboard application, or
  shared team room.
- Application-specific meeting, travel, calendar, commitment, or review
  behavior.
- Final skill, autonomy-contract, or roster semantics.
- A hosted collaboration control plane, accounts, billing, or cross-organization
  discovery.
- Tracking every coding session as a user-facing activity feed.
- Taking control of arbitrary PTYs or injecting commands into unregistered
  sessions.
- Treating persistence, scheduling, email, or AgentMail as the product itself.

## Journey Coverage

| Journey          | Proposed experience                                                                                                     |      Coverage | Principal residual risk                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------: | ---------------------------------------------------------------------------------------- |
| J1 Joining       | One prompt, resumable commissioning, real facilitator handshake, live host and cloud-continuity smoke tests             |        Strong | Permissions and provider setup can still dominate a supposedly simple onboarding         |
| J2 Session brief | Capability-adaptive `UPDATES` surface with truthful progress/check times and no global presence claim                   |        Strong | Narrow terminals, unsupported cloud sessions, and an empty board need explicit fallbacks |
| J3 Answering     | Work stays conversational; results arrive in dedicated messages; board state remains until explicit resolution          |        Strong | Multiple open results require clear natural-language targeting                           |
| J4 Away          | Cloud routine when verified; resume-only promise otherwise; optional standing notification channel                      | Medium–strong | Cloud executor revocation and notification failure must invalidate promises visibly      |
| J5 Failure       | Durable ledger, idempotency, stale-promise state, resumable onboarding, separate execution/presentation/acknowledgement |        Strong | Partial adapter upgrades and stale roster data need acceptance tests                     |
| J6 Travel        | Core can carry async results and owner attention state                                                                  |        Medium | Travel behavior is intentionally deferred to application skills                          |
| J7 Trust         | Provenance, policy basis, explicit agent attribution, secret handling, visible reasons                                  |        Strong | Detailed authority semantics remain deferred                                             |

## Pass 1 — Information Architecture

Score: **7/10**

What works:

- The product boundary is now “collaboration through the agent I already use,”
  not a repository or dashboard.
- Conversation and ambient updates have distinct jobs.
- Collaboration state, setup health, session presence, and routine execution
  have separate owners.
- `NEEDS YOU`, `WORKING`, `WAITING`, and `READY` describe owner-relevant states
  without exposing transport labels.

Findings:

1. “What are you working on?” cannot be a collaboration trigger because it
   belongs to the general harness. Resolved provisionally through explicit
   references to another person’s agent, replies to collaboration updates,
   configured routines, and a future product-named skill.
2. “Agent-to-agent updates” is technically accurate but user-hostile. Resolved
   in user-facing copy as “Anything from the other agents?” and a board titled
   `UPDATES`.
3. Session presence is routing infrastructure, not a navigation category.
   Resolved: no session count or terminal inventory in the board.
4. Setup health leaked into the update summary. Resolved: health appears only
   when the owner asks to check collaboration setup.
5. The final product name and native skill namespace remain open. This is
   acceptable for the internal vertical slice but blocks polished external
   onboarding copy.

## Pass 2 — Interaction and State Coverage

Score: **8/10**

The proposed lifecycle correctly separates:

- collaboration progress;
- result availability;
- presentation in a host;
- explicit owner acknowledgement;
- session presence;
- executor health.

Resolved high-risk states:

- A result remains `READY` after being shown until the owner explicitly resolves
  it.
- A periodic check cannot make old progress look new.
- A notification does not count as delivery or acknowledgement.
- Multiple open sessions use a single automatic presentation claim while
  permitting an explicit re-open elsewhere.
- Closing the host is independent from whether a cloud executor continues.

Residual states requiring adapter tests:

- Cloud executor permission is revoked after a timed promise is made.
- A provider reports a successful schedule but never executes it.
- The originating session exists but cannot accept safe result presentation.
- A result changes after it was presented but before acknowledgement.
- A roster member is removed while a collaboration is waiting.
- An owner says “done” while several results are open.
- An optional external notification bounces or is delayed.
- A migration or upgrade leaves old and new host hooks active simultaneously.

## Pass 3 — Cognitive Walkthrough and Emotional Arc

Score: **8/10**

### First contact

The one-prompt handoff matches the strongest original behavior. The agent
explains the outcome and obtains permission one boundary at a time. The user
never operates a setup CLI.

Risk: offering board profiles, email preferences, and application skills before
the handshake would recreate the rushed onboarding. Resolved: compact is
automatic; optional preferences follow success.

### Waiting

The acknowledgement answers the anxious questions: was it sent, can the host
close, and when is the next check? Continuity is configured once so the user is
not asked to reason about laptop/cloud branches on every handoff.

### Return

The update board restores orientation without becoming the work surface.
Dedicated result messages prevent outcomes from being buried inside unrelated
answers. Explicit acknowledgement protects against scroll-past loss.

### Failure

The item remains visible, retains the last truthful event, and explains the next
recovery step. The design should avoid apologetic or anthropomorphic filler;
diagnosis and repair matter more than reassurance.

## Pass 4 — Trust, Voice, and AI-Slop Risk

Score: **8/10**

Resolved:

- Removed the global `online` indicator.
- Separated `updated`, `checked`, and promised next check.
- Prevented silent movement of a missed promise.
- Required explicit completion.
- Kept work conversational without making the agent imitate a coworker persona.
- Required source attribution to say “Bob’s agent” unless provenance proves Bob
  supplied the answer.

Voice requirements:

- Lead with the outcome.
- Name the actual source and current owner of the next move.
- Do not say “I’ll update you by 10:00” unless an executor has a verified path
  to perform that check.
- Do not expose claims, leases, adapters, sockets, routines, or session
  registries unless diagnosing failure.
- Do not use friendly filler to obscure uncertainty.

## Pass 5 — Visual and Cross-Host System

Score: **7/10**

The semantic system is consistent even when presentation differs:

- Claude can use a persistent command-backed modeline.
- Codex currently needs session-start/resume briefs and quiet-boundary updates
  because its status line supports fixed fields rather than arbitrary external
  state.
- OpenClaw can use native message and notification surfaces.

Requirements:

- Labels, not color, carry state.
- The compact board is the default everywhere.
- Focus and full profiles remain optional later customization.
- The board never contains the substantive result.
- A result is a dedicated conversational message with outcome first.
- Host-owned status fields must not be overloaded with collaboration meaning.

Residual risk: the aligned table will degrade in narrow terminals. Adapters need
a one-line and stacked fallback rather than relying on fixed columns.

## Pass 6 — Accessibility and Responsive Behavior

Score: **6.5/10**

Required before external testing:

- Provide wide, narrow, and single-line renderers.
- Preserve state words when truncating; truncate descriptions before people or
  state.
- Use local time and include the date when an event is not from today.
- Never rely on ANSI color, spinner animation, emoji, or cursor position for
  meaning.
- Offer an ASCII-safe renderer for terminals and assistive technology that
  mishandle Unicode.
- Ensure a screen reader encounters heading, state, person/source, age, and next
  action in that order.
- Avoid continuously changing countdowns; refresh only on meaningful events or
  promised checks.
- Keep full descriptions available through conversation when the modeline
  truncates them.

## Pass 7 — Unresolved Decisions and Readiness

Score: **7/10**

Product decisions already resolved:

- Existing hosts remain the interaction surface.
- Local user-level runtime is the first architecture.
- Collaboration, not persistence, is the product.
- Compact board is the default update surface.
- Conversation remains the work surface.
- Session tracking stays invisible.
- Background continuity is configured once and delegated to verified cloud
  routines when possible.
- Results auto-present as dedicated conversational messages and remain open
  until explicit resolution.
- Application behavior remains in skills and autonomy contracts.

Decisions intentionally deferred:

- Product name and native skill namespace.
- One or multiple named identities per owner.
- Detailed skills, autonomy contracts, and roster governance.
- Hosted control plane and cross-organization discovery.

Questions that must become engineering acceptance tests rather than more product
debate:

- What lifecycle and result-presentation hooks are reliable in each supported
  host?
- How does each cloud executor prove a scheduled check ran independently of the
  local host and machine?
- How is a revoked or drifted executor detected before a promise is missed?
- What can be rendered safely into a resumed proprietary thread?
- How are stale hooks removed during upgrades?

## Nielsen Summary

| Heuristic               | Assessment                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Visibility of status    | Strong after progress/check/promise separation; prove provider health                       |
| Match to the real world | Strong conversational work model; avoid infrastructure terms                                |
| User control            | Explicit result acknowledgement and cancellation are strong                                 |
| Consistency             | Stable semantics across hosts; presentation intentionally adaptive                          |
| Error prevention        | Idempotency and claim leases are strong; stale roster and hook upgrades remain              |
| Recognition over recall | Ambient board and concrete people reduce command memorization                               |
| Flexibility             | Natural language plus future product-named skill; profiles are optional                     |
| Minimalism              | Strong after session inventory, health, and configuration were removed from the board       |
| Recovery                | Resumable onboarding and durable outcomes are strong; provider drift needs proof            |
| Help and diagnosis      | Conversational setup check is appropriate; exact repair paths belong in adapter diagnostics |

## Stakeholder Read

- **Owner:** receives clear timing, return, attention, and completion behavior
  without learning infrastructure.
- **Teammate:** their agent receives bounded requests under their own authority;
  no implication that a human answered when an agent did.
- **Facilitator:** remains the roster and norm anchor without becoming the
  runtime or universal approver.
- **Security/privacy:** benefits from scoped availability, explicit provenance,
  no arbitrary terminal control, and provider-owned secrets.
- **Engineering:** receives canonical state ownership and adapter boundaries but
  still needs a capability conformance matrix.
- **External tester:** gets the same one-prompt commissioning path and should be
  asked for exact failure traces, not offered bespoke setup.

## Prioritized Findings

### P0 — Must hold before implementation is called complete

1. A cloud-backed next-update promise must be verified end to end with the
   interactive host unavailable.
2. Results must remain open until explicit owner resolution.
3. Source attribution must distinguish an agent’s answer from confirmed human
   input.
4. General harness prompts must not accidentally trigger external collaboration.
5. Setup cannot finish before the real facilitator handshake returns and appears
   in the originating host.

### P1 — Must hold before external testing

1. Wide, narrow, single-line, and ASCII renderers.
2. Visible degradation when cloud continuity or notifications stop working.
3. Upgrade migration that removes stale hooks and preserves identity, roster,
   policy, history, and routine bindings.
4. Multiple-result acknowledgement and re-open behavior.
5. A deterministic failure trace retained by onboarding.

### P2 — Learn through dogfood

1. Whether “Anything from the other agents?” remains intuitive when coding
   subagents are also present.
2. Whether optional email improves reach or recreates an inbox product.
3. Which update profile owners choose after several days of real use.
4. Which external tester use cases should become shared skills rather than core
   behavior.

## Recommendation

Proceed to an engineering review of one Claude ↔ Codex vertical slice, not a
general implementation. The slice must include one-prompt onboarding, real
facilitator handshake, hook-populated session registration, verified background
continuity, one delegated request, a dedicated returned result, explicit
acknowledgement, and recovery from one deliberately missed promise.

Do not build a separate dashboard, terminal orchestrator, generalized workflow
engine, or application-specific routines before that slice works on two real
machines.
