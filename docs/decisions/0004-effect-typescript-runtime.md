# 0004: Build the runtime with Effect and TypeScript

- Status: Accepted
- Date: 2026-08-27

## Context

The legacy implementation combined large shell programs, embedded Python,
provider-specific scripts, and implicit JSON contracts. The new runtime has
filesystem, HTTP, process, scheduling, configuration, CLI, retry, persistence,
and test boundaries that need consistent typing and composability.

## Decision

Use TypeScript with the pinned Effect 4 beta APIs. Use Effect Schema for
external and persisted contracts, Config and ConfigProvider for configuration,
Effect CLI for commands, platform services for I/O, Schedule for polling,
Context services and Layers for boundaries, tagged errors for expected failure,
and `@effect/vitest` for tests. Vendor the matching Effect source for API
reference.

## Rationale

Effect supplies the required primitives as one coherent runtime, so the product
does not need hand-written parsers, command dispatch, dependency containers,
retry loops, or I/O wrappers. Schema-derived types keep runtime validation and
TypeScript contracts aligned. Direct pins include the shared Node platform
package because a prerelease caret can otherwise resolve two incompatible Effect
runtimes in an npm installation.

## Consequences

- Package versions must stay aligned and pinned during the beta.
- Services are provided at the program edge, not inside business logic.
- Developers must consult the vendored source when beta APIs differ from older
  documentation.
- The required Effect prepare script remains the only shell implementation.

## Alternatives considered

### Continue with shell and embedded Python

Rejected because boundary contracts remain implicit, composition is difficult,
and host-neutral behavior becomes duplicated across scripts.

### Use plain TypeScript with custom wrappers

Rejected because it would recreate configuration, schema, CLI, scheduling,
service, and error abstractions already provided by Effect.

### Use a stable Effect 3 stack

Rejected for this repository because the selected Effect skill and vendored
source target Effect 4 beta APIs. Version pinning contains the compatibility
risk.
