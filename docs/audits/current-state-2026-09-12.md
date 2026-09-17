# Current-state audit and evaluation plan

Date: 2026-09-12. Scope: expected behavior in the PRD, experience contract, user
stories, commissioning guide, and accepted ADRs. This is a candidate 0.6.0
implementation; publishing and production installation are separate from local
validation.

## Findings and remediation

| Finding                                                   | Required outcome                                                    | Implementation and evidence                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Retrieval consumed presentation eligibility               | A result remains due until visibly shown                            | Snapshot receipts; board/service regressions                                                                   |
| Hook text was treated as visible conversation output      | The host shows updates at its next safe boundary                    | Native event reminders, JSON retrieval, explicit presentation acknowledgement; real transcripts still required |
| Board used the outgoing sender or mail body               | Name the collaborator and task without embedding the result         | Recipient-aware summaries, ASCII rendering, HTTP lifecycle tests                                               |
| Setup could finish on an unrelated or unseen reply        | Correlate facilitator and introduction, require visible result      | Commissioning regressions; completion remains separate                                                         |
| Uncertain introduction response risked duplicate send     | Ordinary resume must not send again blindly                         | Persisted send intent and explicit retry recovery                                                              |
| Installed files were treated as proof of native readiness | Separate structural installation, observation, and trust            | Native hook observation and supported skill smoke checks                                                       |
| Test roots could still affect the production scheduler    | Isolate host profiles and scheduler identity                        | Native environment overrides and eval-label guards                                                             |
| Local cache corruption blocked fresh retrieval            | Recover from live source, report unavailable if no trustworthy data | Fresh-first recovery path; outage behavior remains in live matrix                                              |
| Foreground polling ran twice immediately                  | One poll per scheduled iteration                                    | Removed duplicate initial invocation                                                                           |
| Existing installations had no automatic stable updater    | Stage, verify, activate, quarantine, and recover                    | Stable bootstrap, release manifest/checksum, temporary package and rollback regressions                        |
| Canonical migration files could be silently discarded     | Block conflicts and preserve owner content                          | Recursive preflight/merge and disposable legacy-fixture tests                                                  |
| New code crossed implementation boundaries                | Cohesive modules with public index entry points                     | Enforced domain entry points and one-way Layers; no architecture waivers                                       |
| Roundtrip evidence compared mailbox-local thread IDs      | Correlate cross-inbox replies through the shared request message ID | Recipient-side delivery and request-ID correlation regressions; three live repetitions                         |
| Codex resumed without its private draft directory         | Preserve the isolated home as the sole resume writable root         | Scoped `sandbox_workspace_write.writable_roots` override and native resume evidence                            |
| A selected result could bypass a current item read        | Retrieve selected results before native presentation                | Explicit installed-skill sequence and visibility-order regression                                              |
| AgentMail surfaced presentation state on the thread       | Preserve exact result proof without assuming label placement        | Canonical transport-aware label check plus immutable receipt correlation                                       |

The installed 0.4 source and generated assets matched the checked-out baseline
during inspection. The observed presentation gap was therefore not evidence of
stale installed files. The 0.4 runtime does need one explicit bootstrap upgrade
before future stable releases can update automatically.

## Evaluation layers

Follow-up review also found that Stop hooks need the native continuation
decision, concurrent presentation acknowledgements must preserve both hosts'
visible results, and commissioning must correlate observation and presentation
to the same host. These paths have targeted command and service regressions.
Malformed visibility timestamps are rejected at their persisted Schema
boundaries. Diagnosis requires at least one compatible installed host before
reporting host readiness.

Live setup then reproduced a stale-skill failure: with OpenClaw disabled, Codex
could not refresh its already-owned shared skill after a template change. The
adapter now recognizes the exact owned resource before checking conflicts and
allows the active host to refresh it. Differing unowned shared instructions
still block replacement. Adapter regressions cover both cases. Live setup also
exposed blank tagged-error messages, which hid the cause of failed mail and
adapter operations; expected failures now need useful, sanitized diagnostics.

Small tests cover Schema rejection, configuration defaults, label precedence,
board formatting, hook merge ownership, and release selection. Component tests
exercise real services with controlled transport and temporary filesystem
boundaries. The packaged test installs an actual tarball outside the repository
and exercises startup, template lookup, repair, and broken-candidate rollback.

The [native driver](../../evals/README.md) runs actual Claude and Codex
processes. It records exact conversation IDs, native transcripts, candidate
hashes, and canonical AgentMail label snapshots. It never substitutes a
simulated host for live evidence. Each automated scenario must pass three
consecutive runs.

| Live case                  | Required evidence                                                     | Gate                                                   |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------ |
| Native skill discovery     | Agent discovers the installed skill in its isolated profile           | Both hosts                                             |
| Generic negative prompts   | Ordinary coding questions do not trigger collaboration                | Four negative prompts per host/run                     |
| Commissioning              | Fresh aliases, OTP, restart, host smoke, correlated facilitator reply | No readiness claim before the visible acknowledgement  |
| Request and reply          | Correct recipient, signature, thread, and authorized CC               | Independent canonical message snapshot                 |
| Safe-boundary visibility   | Reply appears in the active conversation after a generic next turn    | Native transcript plus receipt and labels              |
| Repeated retrieval         | Hidden retrieval leaves the result eligible                           | No `sh-presented` until visible acknowledgement        |
| Explicit done and reopen   | Done clears unread; a later reply becomes open again                  | Canonical labels before and after each transition      |
| Untrusted mail             | Instruction-like body is reported as data without execution           | Transcript and absence of unauthorized actions         |
| Outage and stale cache     | Honest fallback/unavailable output; no false all-clear                | Source, warning, last successful sync                  |
| Host closed and sleep/wake | One poller; no promise of execution while asleep                      | Dedicated eval launchd label and clocked evidence      |
| Stable update and recovery | Published candidate verification, safe activation, rollback           | Manifest/hash, selection pointer, owned-file snapshots |
| OpenClaw                   | Installed skill discovers context and visibly presents results        | Supported skill surface; no invented native hook       |

## Current live evidence and blockers

Readonly preflight ran under `/private/tmp/social-harness-eval-audit-20260912`.
Claude 2.1.269 and Codex 0.154.0 were detected. The disposable profiles
correctly reported missing authentication; hook trust and installed skill
discovery were not verified. No model session, inbox signup, or live mail
exchange was performed by this preflight.

The existing Alice and Carol dedicated test inboxes were recovered from their
private AgentMail homes. Both credentials passed read-only inbox checks (HTTP
200). Their original owner aliases and prior collaboration were also located. No
new signup or credential rotation is needed for the roundtrip evaluations. Fresh
signup and OTP behavior remain separate acceptance cases.

The owner confirmed that both existing native CLI logins should be reused.
Direct Claude and Codex model calls both succeeded. The original empty-profile
authentication failure was an evaluation setup issue, not an invalid login. The
runner now supports explicit `--reuse-native-auth`: Claude reads its native
secure credential store, while Codex receives a private auth-cache snapshot.
Candidate configuration, skills, hooks, and mail remain isolated. Both isolated
authentication checks now pass. Native trust, skill activation, and visible
collaboration still require scenario evidence; direct model calls alone do not
establish those behaviors.

Live Claude commissioning and a fresh board request reproduced a visibility
failure in three retained traces: the agent called `presented` before emitting
the board, then claimed it had shown the updates. Stronger skill wording did not
fix the behavior. These attempts are failures, even where an older local
commissioning checkpoint reported completion. The candidate now stages native
presentation drafts and requires the host's Stop event to confirm actual
assistant output. A fresh Claude run then passed exact-board output and native
confirmation. Codex also emitted the board and facilitator result and received a
native confirmation, but its login shell initially selected the installed 0.4
executable. That mixed-runtime attempt is not a clean candidate pass; the
evaluation setup must verify candidate command resolution before repeating it.

The Alice facilitator sent one real acknowledgement to Carol and the two test
owner aliases. Delivery succeeded; it must not be resent while retrying
presentation. Fresh signup and OTP, OpenClaw's supported skill surface, physical
sleep/wake, and a published stable-update cycle remain separate live gates.

Validation continued on 2026-09-13. Both actual hosts passed three consecutive
skill-discovery repetitions and three consecutive generic-negative repetitions
(four ordinary questions per host per repetition). Candidate executable
resolution is now verified through a real login shell. Carol then resumed the
existing conversation, verified Codex presentation, imported Alice's roster, and
completed the saved commissioning checkpoints without resending mail. The
isolated profiles use manual scheduling, so these observations do not establish
normal background readiness.

Review also closed a legacy checkpoint bypass: incomplete commissioning now
revalidates a concrete host's supported presentation proof. Existing completed
historical setups remain compatible. The latest repository gate passed 182
tests, typechecking, lint/Knip, and architecture with zero findings or waivers.

### Completed Claude–Codex lifecycle evaluation

On 2026-09-17, the isolated Alice and Carol profiles completed three successful
full roundtrips. Each recorded a request at the recipient inbox, one peer reply
correlated by the request message ID, a native visible presentation, explicit
completion, and a later unread follow-up that reopened the work. The three
passing evidence directories are private:

- `roundtrip-1-13c742b5-4266-4c97-9f1d-7a0315333bd4`
- `roundtrip-1-65c12055-fe89-4bc8-9bd0-039960aa54d0`
- `roundtrip-1-70250fa2-f7c2-4662-bbda-46b0ec3648fd`

The retained failed traces established and then closed four evaluator or host
integration gaps: sender-inbox delivery assumptions, cross-inbox thread ID
comparison, continuous polling, and missing Codex resume draft access. A later
trace also tightened the skill to require a same-turn `items` read before
presenting a selected result. These failed attempts are not acceptance evidence
and no earlier request was resent automatically.

Fresh signup and OTP, OpenClaw's supported skill surface, physical sleep/wake,
outage and stale-cache behavior, and a published stable-update cycle remain
separate unexecuted live gates.

## Review and release

### Deferred TODO: native hook trust during setup and upgrades

- [ ] Integrate Codex's persisted hook trust into normal setup and software
      upgrades. Use native hook identities and definition hashes, reconcile only
      owned records, and preserve unrelated or explicitly disabled hooks. Verify
      the persisted result through the native API.

The owner requested this follow-up on 2026-09-12 and explicitly deferred its
implementation. The contributor evaluation setup may provision trust for its
isolated test hooks; that does not implement the product setup or upgrade path.

### Current review gates

Run `pnpm check`, `pnpm build`, `node dist/cli.js --help`, and the stable
bootstrap help command. Review the changed public modules with the two audit
agents. Preserve the live evidence directory and record actual pass/fail/blocked
results. Do not publish a release or modify the production installation on the
strength of preflight alone.

The pinned architecture checker has a narrow repository patch: README lookup
uses the analyzed file's real directory instead of assuming all code is under
`src/`. A regression verifies both a documented `evals/` directory and the same
directory with its README missing. The patch preserves the architecture rules.
