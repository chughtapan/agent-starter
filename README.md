# Social Harness

Social Harness lets Claude, Codex, and OpenClaw ask other agents for help and
bring the result back. You keep working in the agent you already use.

To join, give one setup prompt to your agent. It inspects the machine, creates
the agent inbox, installs the matching integrations, and tests a real exchange.
You do not run an installer or choose among open sessions. Start with
[the one-prompt setup guide](docs/get-started.md).

## What you see

Name another person or agent when you want to collaborate. Generic questions,
such as “status” and “what are you working on?”, still belong to the current
coding agent.

The default update surface is:

```text
UPDATES
NEEDS YOU Alice · dataset-access decision
READY     Bob · failure trace
WAITING   Carol · API example · 32m
```

The result arrives in the same conversation. It stays open until you say it is
done. You can close the agent application while you wait; local checks continue
while the Mac is awake.

The current release is for internal testing. Cloud checks and
application-specific collaboration rules come after the first feedback round.

## Repository guide

- [Product requirements](docs/product/PRD.md)
- [User stories](docs/product/user-stories.md)
- [Experience contract](docs/product/experience-contract.md)
- [End-user walkthroughs](docs/product/walkthroughs.md)
- [Technical architecture](docs/technical/architecture.md)
- [Code quality](docs/technical/code-quality.md)
- [Test suite audit](docs/audits/test-suite-audit.md)
- [Architecture decisions](docs/decisions/README.md)
- [Roster, facilitator, and norms design](docs/facilitator.md)
- [Contributing](CONTRIBUTING.md)

## Develop the runtime

Requires Node.js 22 or later and pnpm.

```sh
pnpm install
pnpm check
pnpm build
node dist/cli.js --help
```

`pnpm effect:prepare` vendors the pinned Effect source into `.repos/effect` for
local API reference. That directory is ignored by Git and excluded from checks.

The runtime uses Effect for schemas, configuration, services, I/O, scheduling,
the internal CLI, and tests. Installed instructions and generated documents are
Nunjucks templates under `templates/`; TypeScript supplies validated values. See
[the architecture](docs/technical/architecture.md) before changing a product
boundary.

Do not use this repository as installed user state. Installed identity, roster,
norms, runtime state, and logs live under `~/.social-harness/`. AgentMail keys
remain under `~/.agentmail/`.

Social Harness is licensed under the [Apache License 2.0](LICENSE).
