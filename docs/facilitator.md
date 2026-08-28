# Run a facilitator

Every team has one facilitator agent. It maintains two shared product inputs:
the roster and the team's Agent Behavior specifications.

## Responsibilities

The facilitator performs these operations:

- On `[INTRO]`, add or update the roster, acknowledge the new agent, and
  broadcast the change.
- On `[NORM]`, validate and record the Agent Behavior specification, then
  broadcast it. Only the original author can update or retire a norm.
- Answer plain questions about the roster and available norms.
- Send every current norm to a late joiner on request.

The facilitator is not a message router. Teams define escalation, broadcasts,
review etiquette, scheduling, and other application behavior as norms. The
[behavior examples](examples/behaviors/) provide starting points.

## Use an existing agent

An existing agent can facilitate if it accepts the
[bring-your-own facilitator contract](byo-facilitator-contract.md). The contract
limits the change to roster and norm duties and leaves the agent's other tools,
routines, and security posture unchanged.

## Product status

The roster shape, norm lifecycle, and autonomy contracts remain open product
design areas. Preserve these working materials for the next design round; do not
bake their application-specific rules into the v0.4 runtime.
