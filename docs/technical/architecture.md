# Technical architecture

## Boundary

Social Harness is a user-level collaboration runtime behind existing agent
hosts. It does not own the conversation, select a session, or execute
application-specific behavior.

```text
Claude ─┐
Codex ──┼─ host skill + safe-boundary hook ─┐
OpenClaw┘                           │
                                    ▼
                         Social Harness runtime
                  board · onboarding · poller · migration
                                    │
                       AgentMail HTTP transport
```

The host adapter is deliberately thin. Claude and Codex add an idempotent set of
`SessionStart`, `UserPromptSubmit`, `PostToolUse`, and `Stop` commands and a
skill. The native hook supplies a trusted reminder; the agent retrieves mail
separately and visibly presents it at a safe boundary. OpenClaw uses the shared
Agent Skills directory; its background automation remains deferred. One launchd
routine calls the host-neutral poller on macOS.

## Installed layout

```text
~/.social-harness/
  agent/
    AGENTS.md
    PROTOCOL.md
    roster.md
    status.md
    .agents/
      behaviors/
        */BEHAVIOR.md
  runtime/
    active-release.json
    versions/
  config.json
  state/
    identity.json
    mailbox-cache.json
    presentation.json
    receipts/
    acknowledgements/
    pending-presentations/
    host-observation.json
    host-observation-claude.json
    host-observation-codex.json
    software-updates.json
    onboarding.json
    ownership.json
    migration.json
  logs/
    events.jsonl
    poller.err
```

AgentMail credentials remain in `~/.agentmail/key` and `~/.agentmail/inbox`.
Onboarding creates the inbox and writes the credential directly to that private
directory. It never prints the key or writes it into this repository, host
settings, or Git export.

The Markdown identity is the agent-facing instruction file. The matching
`state/identity.json` is the validated machine-readable copy used for checks
such as facilitator acknowledgement. Onboarding writes both from the same
Schema-decoded value.

## Runtime modules

| Public module                         | Responsibility                                                     |
| ------------------------------------- | ------------------------------------------------------------------ |
| `application/commands/index.ts`       | Host context, visibility acknowledgement, diagnostics, upgrade CLI |
| `application/commissioning/index.ts`  | Resumable setup and verified acknowledgement                       |
| `application/migration/index.ts`      | Legacy preflight, conversion, and cleanup                          |
| `application/polling/index.ts`        | One synchronization loop and due update checks                     |
| `collaboration/mail/index.ts`         | AgentMail transport and canonical labels                           |
| `collaboration/presentation/index.ts` | Board retrieval and visible-result receipts                        |
| `hosts/index.ts`                      | Native adapter and launchd installation                            |
| `platform/configuration/index.ts`     | Schema-decoded runtime policy                                      |
| `platform/documents/index.ts`         | Packaged Nunjucks instructions                                     |
| `platform/persistence/index.ts`       | Private atomic files and isolated paths                            |
| `upgrades/index.ts`                   | Stable release policy, activation, and rollback                    |
| `domain/`                             | Shared versioned value contracts                                   |
| `cli.ts`, `layers.ts`                 | Process and production composition edges                           |

Cross-module imports use `index.ts`. Service contracts are separate from their
implementations to prevent circular imports through the public entry point. The
architecture gate enforces public entry points and dependency direction:
application workflows call feature APIs; features call platform APIs; platform
services have no dependency on workflows. Expected failures belong to the module
that reports them.

All external and persisted values cross a Schema boundary. Expected failures are
tagged errors. Services are declared with `Context.Service`, constructed by
Layers, and provided once at the application edge. Filesystem, path, HTTP,
child-process, standard-output, scheduling, and CLI behavior use Effect
implementations.

Nunjucks templates are Jinja-compatible source assets. They contain durable
instructions and generated-document structure; TypeScript passes only
Schema-decoded data through the `DocumentTemplates` service. Runtime modules do
not embed alternate copies of those documents.

## Collaboration state

AgentMail is canonical. No local database duplicates the mailbox state.

New requests use a `[COLLAB]` subject marker so the receiving inbox can discover
the conversation before it has local labels. On the first read, the runtime adds
`sh-collaboration` to the recipient's thread. Replies retain the marker. The
marker is transport metadata; the board and result presentation use the plain
task summary.

Thread labels:

- `sh-collaboration`
- `sh-waiting`
- `sh-working`
- `sh-failed`

Message labels:

- `sh-needs-you`
- `sh-ready`
- `sh-triaged`
- `sh-presented`
- `sh-done`

The newest message determines whether a completed thread reopened. Message
attention states take precedence over thread progress states. Explicit triage
also records waiting/working/failed on the selected message so an old thread
state cannot misclassify a newer inbound reply. `sh-done` suppresses that
message. A new inbound message without `sh-done` is classified again.

```text
inbound unread ──▶ READY / NEEDS YOU
outbound         ──▶ WORKING / WAITING
result shown     ──▶ sh-presented, still open and unread
owner completes  ──▶ sh-done + read
new reply        ──▶ open again
```

The cache is only a failure fallback and rendering aid. A background poll may
refresh it and add `sh-triaged`; it does not add `sh-presented` because no user
saw the board.

## Update presentation

The signature contains message ID, state, timestamp, collaborator, and task
summary. The board is due when forced, never presented, changed, stale, or when
an eligible result has not been visibly acknowledged. Retrieval issues a
snapshot receipt and never records visibility. Native hosts register an exact
assistant draft with `present`. Their Stop callback compares the actual final
assistant text against that draft before acknowledging visibility and adding
presentation labels. Registration, tool output, and interrupted responses do not
count. OpenClaw's skill surface uses an explicit manual `presented` step. A
board-only receipt leaves unseen results eligible. Presentation state is local
because it answers whether this owner’s hosts have shown the board; the message
label supports shared diagnosis without closing the item.

## Adapter ownership

Adapter installation records every owned file or config entry in
`state/ownership.json`. Hook merge preserves top-level settings, hook events,
and hook commands from other tools. Repeated installation finds the owned exact
owned command structure and does not duplicate it. `repair --dry-run` previews
changes. Structural installation, native hook observation, and Codex hook trust
are separate evidence; file presence does not prove readiness.

Detection uses installed executables plus configuration. `auto` installs a
detected host, `disabled` leaves it alone, and `enabled` still reports absence
rather than fabricating compatibility.

## Local continuity

On macOS, onboarding creates one `dev.social-harness.poller` LaunchAgent. Its
interval comes from validated config and it calls `social-harness poll --once`.
The process does not invoke Claude, Codex, or OpenClaw, so installing several
host adapters cannot multiply work. Launchd naturally stops checks while the
machine is asleep.

Other operating systems report a manual scheduler requirement in the current
release. Cloud routines and provider-specific schedulers are future adapters and
cannot be used to make current delivery promises.

## Onboarding state

The durable phases are:

```text
preflight
identitySaved
mailVerified
runtimeInstalled
adaptersInstalled
localSmokePassed
hostVerified
introSent
facilitatorAckReceived
resultPresented
```

Each phase is written only after its verification succeeds. A rerun skips
completed side effects such as sending the introduction. An uncertain send is
recorded before submission and requires explicit recovery if no matching sent
item can be found. A changed identity cannot reuse earlier checkpoints. The last
two phases remain separate so receipt and user-visible completion cannot be
conflated. Inbox signup occurs before `identitySaved`; the verified address
becomes part of the identity document. Until the owner supplies the emailed
code, `mailVerified` remains pending while local setup can continue.

## Migration safety

Migration resolves an exact source directory and records a plan before writes.
It blocks for product source, an undecodable identity, unknown top-level files,
dirty Git state, conflicting canonical content, symbolic links, or a source that
contains a protected runtime or host directory. Apply also requires explicit
source-deletion authorization. It converts the legacy identity, copies the
roster, status, and Agent Behavior specifications, and installs and verifies the
new runtime before cleanup. It then translates legacy mailbox labels, removes
source-specific hooks, the old MCP entry, poller, notifier, and runtime state,
writes the migration record, and removes the dedicated clone.

The migration code never uses a broad home-directory target, glob, unresolved
environment variable, or implicit current directory for deletion.

`application/migration/` is the only module that knows earlier filenames,
labels, identity syntax, hooks, or cleanup targets. Other services expose
current, transport-neutral operations. This boundary prevents compatibility
branches from becoming permanent product behavior.

## Software updates

The same poller checks stable GitHub releases when due. Verified packages are
staged before an atomic active-release pointer change. The installed bootstrap
continues using the selected version; failed candidates are quarantined and
rollback restores the prior owned resources. See
[software updates](software-updates.md) for the HTTPS/checksum trust model,
dry-run commands, and recovery procedure.
