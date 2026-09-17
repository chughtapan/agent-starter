# 0009: Apply stable software releases through the existing local poller

- Status: Accepted
- Date: 2026-09-12

## Context

Installed skills, host wiring, and runtime code can drift independently from the
product repository. The owner explicitly requested automatic stable GitHub
release updates during the live collaboration audit. Requiring an owner to
operate an updater would recreate the installer experience the product removes.

## Decision

The existing local poller checks the fixed `chughtapan/agent-starter` GitHub
repository once daily by default. Only published stable semantic-version tags
are eligible. Older configuration decodes with `softwareUpdates.enabled: true`
and `softwareUpdates.checkInterval: PT24H`. The owner can disable automatic
checks through configuration. No second timer, cloud routine, configurable code
source, or host trust bypass is introduced.

Download the release checksum manifest and exact package asset over HTTPS from
the fixed repository. Restrict redirects to GitHub's release asset origin,
validate the manifest with Schema, and verify the archive's SHA256 before
installing it. npm resolves the package's dependencies from the fixed public npm
registry with lifecycle scripts disabled. The trust boundary is the maintained
GitHub repository and npm dependency distribution; a checksum is integrity
evidence, not an independently verified release signature.

Install into a private staging directory, verify package identity, required
assets, CLI startup, and configuration loading, then move the installation into
an immutable version directory. Atomically select it through one private JSON
pointer. The initially installed bootstrap remains stable and delegates to the
selected CLI, so hooks and the existing scheduler do not require rewrites on
every release.

Reconcile only adapter-owned resources after activation. Preserve the previous
release and snapshot exact adapter files for failure restoration. Failed or
explicitly rolled-back versions are quarantined from automatic installation. A
failed startup restores a verified previous release before running the user's
command; a failed business command is never replayed automatically.

## Consequences

- Automatic checks run only while the machine is awake and inherit the existing
  poller's schedule.
- Current work can finish on its loaded version; later CLI invocations use the
  selected version.
- A release must preserve existing configuration and state compatibility so the
  previous runtime remains a usable rollback target.
- Release publication is a maintained GitHub Actions workflow triggered by an
  exact version tag. It runs review checks and builds the package before
  publishing the checksum manifest and archive.
- An interrupted update can leave a lock or quarantined version for inspection.
  Diagnosis names the exact artifact; it never guesses at home-directory cleanup
  targets.
- Initial installation still needs Node.js 22 and npm. GitHub CLI is used by
  release CI, not required on an installed user's machine.

## Alternatives considered

- Updating from a moving branch was rejected because it has no reviewed stable
  release or immutable package boundary.
- A separate updater daemon was rejected because the existing poller already
  owns local scheduling.
- Replacing the active installation in place was rejected because interrupted
  writes could break both the current command and its recovery path.
- Requiring local GitHub CLI and attestation verification was deferred to avoid
  adding a new machine prerequisite to the Node.js bootstrap.
