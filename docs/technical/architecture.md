# Technical architecture

## Boundary

Social Harness is a user-level collaboration runtime behind existing agent
hosts. It does not own the conversation, select a session, or execute
application-specific behavior.

```text
Claude ─┐
Codex ──┼─ host skill + start hook ─┐
OpenClaw┘                           │
                                    ▼
                         Social Harness runtime
                  board · onboarding · poller · migration
                                    │
                       AgentMail HTTP transport
```

The host adapter is deliberately thin. Claude and Codex add an idempotent
`SessionStart` command and a skill. OpenClaw uses the shared Agent Skills
directory; its background automation remains deferred. One launchd routine calls
the host-neutral poller on macOS.

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
  config.json
  state/
    identity.json
    mailbox-cache.json
    presentation.json
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

| Module or directory | Responsibility                                           |
| ------------------- | -------------------------------------------------------- |
| `domain/`           | Cohesive current Schemas for config, identity, and state |
| `config.ts`         | Config and ConfigProvider decoding plus Schema encoding  |
| `paths.ts`          | User-level paths derived from Effect Config              |
| `storage.ts`        | Private, atomic filesystem persistence                   |
| `templates.ts`      | Typed rendering service for packaged Nunjucks assets     |
| `templates/`        | Installed instructions, messages, and generated files    |
| `mailbox.ts`        | AgentMail HTTP boundary and canonical label transitions  |
| `board.ts`          | Compact rendering and presentation policy                |
| `adapters.ts`       | Additive Claude, Codex, and OpenClaw installation        |
| `scheduler.ts`      | One machine-local timer adapter                          |
| `poller.ts`         | Host-neutral synchronization through Effect Schedule     |
| `onboarding.ts`     | Resumable commissioning checkpoints and smoke tests      |
| `migration.ts`      | All compatibility parsing, translation, and cleanup      |
| `cli.ts`            | Effect CLI used by skills, hooks, and diagnostics        |
| `layers.ts`         | Dependency graph, provided at the program edge           |

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
attention states take precedence over thread progress states. `sh-done`
suppresses that message. A new inbound message without `sh-done` is classified
again.

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

The presentation signature contains message ID, state, and update timestamp. The
board is due when forced, never presented, changed, or older than
`updates.staleAfter`. Presentation state is local because it answers whether
this owner’s hosts have shown the board; the message label supports shared
diagnosis without closing the item.

## Adapter ownership

Adapter installation records every owned file or config entry in
`state/ownership.json`. Hook merge preserves top-level settings, hook events,
and hook commands from other tools. Repeated installation finds the owned
command marker and does not duplicate it.

Detection uses installed executables plus configuration. `auto` installs a
detected host, `disabled` leaves it alone, and `enabled` still reports absence
rather than fabricating compatibility.

## Local continuity

On macOS, onboarding creates one `dev.social-harness.poller` LaunchAgent. Its
interval comes from validated config and it calls `social-harness poll --once`.
The process does not invoke Claude, Codex, or OpenClaw, so installing several
host adapters cannot multiply work. Launchd naturally stops checks while the
machine is asleep.

Other operating systems report a manual scheduler requirement in v0.4. Cloud
routines and provider-specific schedulers are future adapters and cannot be used
to make current delivery promises.

## Onboarding state

The durable phases are:

```text
preflight
identitySaved
mailVerified
runtimeInstalled
adaptersInstalled
localSmokePassed
introSent
facilitatorAckReceived
resultPresented
```

Each phase is written only after its verification succeeds. A rerun skips
completed side effects such as sending the introduction. The last two phases
remain separate so receipt and user-visible completion cannot be conflated.
Inbox signup occurs before `identitySaved`; the verified address becomes part of
the identity document. Until the owner supplies the emailed code, `mailVerified`
remains pending while local setup can continue.

## Migration safety

Migration resolves an exact source directory and records a plan before writes.
It blocks for product source, an undecodable identity, unknown top-level files,
or dirty Git state. Apply also requires explicit source-deletion authorization.
It converts the legacy identity, copies the roster, status, and Agent Behavior
specifications, and installs and verifies the new runtime before cleanup. It
then translates legacy mailbox labels, removes source-specific hooks, the old
MCP entry, poller, notifier, and runtime state, writes the migration record, and
removes the dedicated clone.

The migration code never uses a broad home-directory target, glob, unresolved
environment variable, or implicit current directory for deletion.

`migration.ts` is the only runtime file that knows earlier filenames, labels,
identity syntax, hooks, or cleanup targets. Other services expose current,
transport-neutral operations. This boundary prevents compatibility branches from
becoming permanent product behavior.
