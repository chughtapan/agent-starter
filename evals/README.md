# Real host evaluations

This contributor-only driver runs the installed Claude and Codex executables. It
records native events, visible assistant text, exact conversation IDs, and
canonical AgentMail labels. It follows the
[experience contract](/docs/product/experience-contract.md) and
[user stories](/docs/product/user-stories.md). Repository maintainers own this
suite; it is not a user-facing session manager.

The normal component suite tests deterministic boundaries. This suite tests the
behavior of real hosts, skills, and services. A component test, installed file,
successful poll, or hidden hook output does not prove that the owner saw a
result.

## Prepare and inspect the pair

Build the candidate, then prepare a new, disposable test root:

```sh
pnpm build
pnpm evals --root /private/tmp/social-harness-eval-review --prepare
```

Without `--execute`, the driver runs local version and authentication checks and
writes `evidence/preflight.json`. It does not call a model, sign up an inbox, or
send mail. `--prepare` installs only into the two isolated profiles. It disables
notifications, automatic software updates, and scheduling for these live-agent
cases so the runtime under evaluation stays fixed.

The driver owns the marker `.social-harness-eval.json`. It refuses to reuse an
unmarked existing directory and rejects profile symlinks that escape the root.
The only exception is Codex's native `tmp/arg0` executable aliases: their fixed
names must point to a regular executable `bin/codex`. Credential, skill, and
configuration links remain prohibited. Every child gets an isolated `HOME`,
`CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `SOCIAL_HARNESS_USER_HOME`,
`SOCIAL_HARNESS_HOME`, and `AGENTMAIL_HOME`. It does not inherit provider keys,
production mail overrides, or native profile overrides. The real
`~/.agents/skills` cannot satisfy skill discovery in these homes.

Preparation appends owned candidate PATH blocks to each isolated `.zprofile` and
`.zshrc`, preserving other shell customizations. The `candidate-cli` preflight
check starts a real zsh login shell and requires `social-harness` to resolve to
`<root>/bin/social-harness`. This prevents native login-shell PATH
initialization from silently selecting an older global installation.

Containment checks repeat the entire directory walk at most twice when a native
cache file disappears during enumeration. A permission failure or an escaping
link stops immediately. No missing path is ignored, and each retry also checks
entries created since the preceding walk.

Authenticate the native profiles using the providers' supported flows before
executing model scenarios. The profiles are:

| Host   | Child home            | Native profile                |
| ------ | --------------------- | ----------------------------- |
| Claude | `<root>/homes/claude` | `<root>/homes/claude/.claude` |
| Codex  | `<root>/homes/codex`  | `<root>/homes/codex/.codex`   |

Run native authentication and trust review with these same environment paths.
Keep all AgentMail secrets under that profile's `.agentmail` directory. Never
put keys or tokens in a fixture, prompt, or report.

When the owner authorizes using existing CLI logins, add `--reuse-native-auth`
to preparation and execution commands. Claude reads its existing credential
store through `CLAUDE_SECURESTORAGE_CONFIG_DIR`; its configuration, skills, and
hooks still come from the isolated profile. Codex receives a one-time private
copy of only its native `auth.json`, with mode `0600`. The runner never
overwrites an existing copy or writes to the source auth file. It never copies
the rest of a native profile or creates credential symlinks.

Preflight records the authentication mode for each host. Run evaluations
serially: normal provider token refresh may update the private Codex copy. If
that copy stops authenticating, verify the original CLI login and deliberately
replace only the eval copy before retrying. See
[Codex authentication](https://developers.openai.com/codex/auth/) for the
provider's auth-cache behavior. Without this opt-in, both native profiles must
be authenticated separately.

For authorized isolated runs, use `--trust-owned-hooks` to persist Codex trust
through its local native API. The evaluator validates the owned hook source,
command, and native definition hash, updates the corresponding trust records,
and verifies them through a fresh native read. It preserves unrelated and
explicitly disabled hooks. Normal product setup and upgrade integration remains
a
[deferred TODO](../docs/audits/current-state-2026-09-12.md#deferred-todo-native-hook-trust-during-setup-and-upgrades).

Preparation adds explicit permissions to the disposable Claude profile for
`context`, `updates`, `items`, `present`, `request`, `reply`, `done`, `triage`,
`onboard`, and `doctor`, through either the candidate launcher or its command
name. It grants file edits throughout that host's isolated home, including
message drafts outside `workspace`. The native `Edit(//<home>/**)` rule covers
both Write and Edit calls; current Claude ignores scoped `Write(path)` rules.
See [Claude permission rules](https://code.claude.com/docs/en/permissions).

Preparation preserves unrelated settings and existing ask/deny rules. It records
the exact grants in the private `native-permissions.json` file, and preflight
reports missing grants or obvious conflicts. It does not grant arbitrary Bash
commands or a permission bypass. Every new and resumed Codex invocation enables
`sandbox_workspace_write.network_access=true` within its workspace-write
sandbox. Resumed Codex turns also receive the isolated home as their sole
`sandbox_workspace_write.writable_roots` value, so they can save required
private drafts without expanding access beyond the disposable profile. Both
settings use native CLI overrides instead of changing the profile's TOML. See
[Codex configuration](https://developers.openai.com/codex/config-reference/).

The driver disables interactive permission prompts, so any ungranted Claude
command is denied. Configured grants establish a prerequisite; actual native
tool calls establish permission success. A native permission denial blocks the
run. Retain that evidence and inspect existing ask/deny or managed settings
before retrying.

## Run declared scenarios

The default is three repetitions. Use `--repeats 1` for diagnosis, then repeat
three times for release evidence. Each repetition starts fresh native
conversations; continuation turns use only IDs captured from those
conversations. The default per-turn deadline is 180 seconds, configurable with
`--timeout-seconds` from 10 to 600. Timed-out runs retain partial event output.

```sh
pnpm evals --root /private/tmp/social-harness-eval-review \
  --execute --scenario skill-discovery
pnpm evals --root /private/tmp/social-harness-eval-review \
  --execute --scenario generic-negative
```

| Scenario           | Trigger                                                                                   | Automated evidence                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `skill-discovery`  | Explicitly invoke Social Harness and read its skill                                       | Native skill read, valid assistant output, no mail mutation                                                                |
| `generic-negative` | Start with arithmetic, then ask `status`, `what are you working on?`, `inbox`, and `team` | Same native conversation ID, no unauthorized collaboration mutation                                                        |
| `roundtrip`        | Ask the named test agent to inspect `retry.log`                                           | One canonical request, result on a normal resumed turn, named source, unread preserved, explicit done, later reply reopens |

Read-only discovery can pass independently while hook verification remains
blocked: the runtime records hook observations only after an identity exists.
The driver reports that distinction in `checks.json`.

## Authorize dedicated test mail

Mail scenarios require two authorized, verified test inboxes with distinct owner
aliases. Reuse existing dedicated test accounts when available; new signup is
needed only for the fresh-signup acceptance case. Copy only the dedicated test
mailbox credentials into each isolated profile's `.agentmail` directory,
preserving the originals. Never sign up again to recover an existing account:
doing so can rotate its credential.

Onboard each isolated profile through the normal product flow. The test pair's
purposes and autonomy must explicitly permit the `retry.log` exchange, and both
agents must appear in their rosters. Do not use an existing team roster or
production facilitator.

Copy `fixtures/pair.example.json` into the disposable root. Set
`dedicatedTestIdentities` to `true` only after the test pair has been
authorized. For both `claude` and `codex`, add `ownerEmail` and `inbox`, and
make `name` match the installed agent name. The driver validates these
declarations against the isolated identity and mailbox metadata. It also rejects
recipients outside the two agents and their two test owners in the installed
identity, roster, and protocol. Pending OTP verification blocks execution.

```sh
pnpm evals --root /private/tmp/social-harness-eval-review \
  --fixture /private/tmp/social-harness-eval-review/pair.json \
  --execute --scenario roundtrip
```

The requester is Claude and the responder is Codex. The responder receives an
explicit owner prompt authorizing the local fixture read and reply; incoming
mail never grants execution authority. Owner copies follow the installed
protocol. The runner performs only read-only AgentMail GETs for its independent
label oracle. Product commands and the two real agents perform the exchange.

The roundtrip driver stops after a failed or blocked repetition. It never
retries a potentially delivered send automatically. Inspect the unique subject
and canonical mailbox evidence before retrying. Final follow-up results remain
open for review; the driver does not delete inboxes or mark all work done.

## Inspect evidence and grade the release

Every scenario directory contains the exact prompt, redacted native JSONL,
stderr, extracted visible text, decoded tool and hook events, `checks.json`, and
`verdict.json`. Mail runs also record IDs and labels after each lifecycle step.
The preflight records native versions, Node version, candidate CLI hash, and
isolation mode. Credential patterns are redacted before persistence; review
reports before sharing them. Private native auth files stay outside evidence.

`pass` requires the stated observation. `fail` means observed behavior violated
the check. `blocked` means a prerequisite, permission, timeout, or external
service prevented the observation. `--execute` exits unsuccessfully for failed
or blocked runs. Preflight alone is informational and never counts as dogfood.

The driver checks staged presentation against native event order and the
immutable Stop confirmation. The exact board and selected result must appear in
assistant text, and the same host's confirmation must match that message's hash,
receipt, and pending request. A tool result, hidden hook message, or later claim
to have shown the board cannot satisfy that check. Agent-issued hook commands
invalidate native evidence. The roundtrip also ties delivery and completion to
the exact newly received peer messages, so older unread work cannot mask a
missing result.

The automated content check is deliberately small. A reviewer must also inspect
visible transcripts for outcome-first wording, an accurate source, the reminder
that work stays open, a faithful board, and the absence of session or transport
chores in the owner's conversation. Lexical matches alone are not a release
approval.

## Complete the remaining acceptance matrix

These cases complement the three executable scenarios. Record the same native,
visible, canonical, and owned-resource evidence for every manual case. Mark a
case blocked until it has been observed; do not infer it from a nearby pass.

| Area             | Additional real acceptance checks                                                                                                                                                        | Deterministic coverage                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Setup            | Fresh signup, OTP wait and resume, facilitator and member paths, interrupted introduction, visible host commissioning                                                                    | Onboarding state and idempotency tests                   |
| Awareness        | New mail during an active turn, each native hook event, unchanged board suppression, changed and stale boards, interrupted presentation before receipt                                   | Board and presentation-receipt tests                     |
| Completion       | Multiple open items ask which one; explicit all; unrelated items remain open; sent-only progress; reply after done                                                                       | Mailbox classification and HTTP label tests              |
| Authority        | Unknown sender, conflicting roster, mail containing instructions, links and attachments, request beyond autonomy                                                                         | Schema and mailbox boundary tests plus transcript review |
| Continuity       | Exit both hosts after send, wait for the existing poller, resume exact captured IDs, sleep/wake catch-up, unavailable network recovery                                                   | Poll locks, stale cache, scheduler tests                 |
| Installation     | Reinstall, native profile overrides, disabled adapters, adjacent user hooks, shared skills, malformed config, ownership completeness                                                     | Adapter, path, and scheduler tests                       |
| Software updates | Published stable release, download verification, active pointer change, owned adapter reconciliation, rollback after failed health, user settings preserved, updated native trust review | Upgrade release and recovery tests                       |
| OpenClaw         | Installed skill discovery, explicit activation and ordinary negative prompts, new-session and watcher refresh, visible result                                                            | Supported skill-surface checks; no native-hook claim     |

For the separate macOS continuity check, use a third disposable profile and
`SOCIAL_HARNESS_LAUNCHD_LABEL=dev.social-harness.eval.<safe-id>` with launchd
mode. Record the exact owned plist and label. Remove only that recorded eval job
when finished. Never reuse `dev.social-harness.poller`: explicit test-home
overrides are rejected with the production label even when the child `HOME`
equals the test home. The main pair driver always stays in manual mode.

Run `pnpm check`, `pnpm build`, and `node dist/cli.js --help` before review.
Require three passing repetitions of each applicable live scenario and reviewed
transcripts before claiming the corresponding host behavior works. A supported
host or release case that remains blocked must remain visible in the report.
