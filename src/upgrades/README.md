# Stable software updates

This capability selects, stages, activates, and recovers stable Social Harness
releases. Runtime callers import its curated `index.ts` boundary. The existing
poller invokes `Upgrades.checkIfDue`; this folder does not own another timer.

`service.ts` owns the update policy, exclusive update lock, atomic version
selection, adapter restoration, and quarantine records. `releases.ts` owns the
fixed GitHub release source, checksum verification, private npm staging, and
candidate process verification. Its Effect service is replaceable in tests.

`../application/commands/upgrades.ts` exposes agent-operated check, apply, and
rollback commands. `ports.ts` defines the public service contracts.
`bootstrap.ts` is the package executable and stable scheduler target. It
composes only the services needed to select a working release and recover before
the requested command starts; it does not load the full CLI service graph.

Persisted contracts live in `../domain/upgrades.ts`. See
[`software-updates.md`](../../docs/technical/software-updates.md) for the
release trust boundary, owner controls, and recovery procedure.
