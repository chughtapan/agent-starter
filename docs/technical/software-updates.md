# Stable software updates

Social Harness checks for a newer stable release through the same local routine
that checks collaboration mail. The default is once every 24 hours while the
machine is awake. The owner can ask the current agent to check, update, or roll
back; the commands below are for that agent.

## Inspect and control

```sh
social-harness upgrade status
social-harness upgrade check
social-harness upgrade apply --dry-run
social-harness upgrade apply
social-harness upgrade rollback --dry-run
social-harness upgrade rollback
```

`status` reads local state. `check` and `apply --dry-run` inspect the stable
GitHub release without writing installation state or downloading executable
code. `rollback --dry-run` identifies the rollback target without changing it.
These diagnostics are separate from the collaboration update board.

The optional public configuration field is:

```json
{
  "softwareUpdates": {
    "enabled": true,
    "checkInterval": "PT24H"
  }
}
```

Existing configuration receives these defaults during Schema decoding; it does
not need a destructive migration. `enabled: false` disables background software
updates. Explicit update and rollback commands remain available.

## Installation and recovery

Eligible releases are stable `vMAJOR.MINOR.PATCH` tags from
`chughtapan/agent-starter`. Each release provides `release.json` and an archive
named `social-harness-MAJOR.MINOR.PATCH.tgz`. Metadata and downloads stay on the
fixed GitHub release origins. The archive SHA256 must match the manifest. The
updater installs the verified package with npm lifecycle scripts disabled, then
checks package identity, required templates, CLI startup, and isolated
configuration loading. npm receives private configuration and a staging home;
user npm configuration and credentials are not passed to the installer.

Versions live under `~/.social-harness/runtime/versions/`. The atomic
`runtime/active-release.json` pointer selects a version and records its baseline
and previous version. The package's original `dist/upgrades/bootstrap.js`
remains the stable entry point used by the installed command and scheduler. Use
this public entry point when testing upgrades; directly invoking a selected
version's `dist/cli.js` bypasses startup recovery.

Before changing the active pointer or owned adapter files, the updater writes
`runtime/activation-journal.json` with the prior selection and exact file
snapshots. The stable bootstrap restores that journal before it delegates to a
selected release, so an interrupted update or rollback cannot run with partial
adapter changes. The journal is removed only after activation completes or all
prior files have been restored.

Activation runs `repair --adapters-only` from the candidate package. It does not
reload its own running launchd job or enable a host's disabled hook trust. If
repair fails, the previous selection and exact adapter files are restored. The
failed release directory is retained for diagnosis and its version is
quarantined. A failed startup similarly rolls back before the requested command
runs. A command that has begun real work is never replayed after failure.

TODO: Integrate persisted Codex hook trust into normal setup and upgrades. This
product change is explicitly deferred; see the
[audit follow-up](../audits/current-state-2026-09-12.md#deferred-todo-native-hook-trust-during-setup-and-upgrades).

`state/software-updates.json` records the last automatic check, quarantined
versions, and the last failure. Automatic failures also append a
`software-update.failed` event. If an interrupted process leaves
`runtime/upgrade.lock`, the agent must confirm no updater is running before
removing that exact lock and retrying. Preserve the version directory and user
data while investigating.

The previous version must remain compatible with current user state. Releases
that need irreversible state changes require a separate product decision and
migration design. HTTPS and SHA256 verify the configured release distribution;
this implementation does not claim independent signature verification.

## Publish a release

The release workflow checks that a stable tag exactly matches `package.json`,
runs `pnpm check`, builds the package, and verifies the bootstrap help. It packs
the installed artifacts and templates, generates the checksum manifest, and
creates the GitHub release. Creating a tag or running publication remains a
separate authorized release action; local audit tests do neither.

Do not replace an already published archive with different bytes. Publish a new
version so checksum failures and quarantined releases remain reproducible.

## Verification

The hermetic updater tests exercise old-config defaults, a read-only check,
stable version ordering through the public update service, successful automatic
activation and rollback, failed staging, repair restoration, daily cadence,
disabled updates, invalid release selectors, an untrusted redirect, a missing
release, and a checksum mismatch before npm. They use temporary homes and
replace the HTTP and package-process boundaries; they do not establish that a
published release works on a real host.

The packaged-install regression builds and packs the actual package, installs
its tarball into a temporary npm prefix using an offline dependency fixture, and
invokes the installed bootstrap outside the source checkout. It checks packaged
template repair and recovery from a deliberately broken selected version. Its
host executables are fixtures; it does not establish real host skill discovery
or trust behavior.

Installations older than 0.5.0 need a one-time installation of the stable
bootstrap before they can update automatically. Before relying on automatic
updates, publish a reviewed release newer than that baseline and test the
installed package advancing to it in an isolated identity. Verify the selected
version, refreshed skill, unchanged host trust, preserved unrelated settings,
one local scheduler, and a real rollback. Retain the resulting trace with the
host and package versions.
