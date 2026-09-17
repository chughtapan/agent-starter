/**
 * @file Exposes inspected, automatic, and reversible stable software updates.
 */

import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Command from 'effect/unstable/cli/Command';
import * as Flag from 'effect/unstable/cli/Flag';

import { Upgrades } from '../../upgrades/index.js';

const status = Command.make(
  'status',
  {},
  Effect.fn('cli.upgrade.status')(function* () {
    const upgrades = yield* Upgrades;
    yield* Console.log(JSON.stringify(yield* upgrades.status(), null, 2));
  }),
).pipe(Command.withDescription('Report local stable-release state.'));

const check = Command.make(
  'check',
  {},
  Effect.fn('cli.upgrade.check')(function* () {
    const upgrades = yield* Upgrades;
    yield* Console.log(JSON.stringify(yield* upgrades.check(), null, 2));
  }),
).pipe(
  Command.withDescription('Inspect the stable release without installing.'),
);

const apply = Command.make(
  'apply',
  { dryRun: Flag.boolean('dry-run') },
  Effect.fn('cli.upgrade.apply')(function* ({ dryRun }) {
    const upgrades = yield* Upgrades;
    const result = yield* dryRun ? upgrades.check() : upgrades.apply();
    yield* Console.log(JSON.stringify(result, null, 2));
  }),
).pipe(
  Command.withDescription('Stage and activate a verified stable release.'),
);

const rollback = Command.make(
  'rollback',
  { dryRun: Flag.boolean('dry-run') },
  Effect.fn('cli.upgrade.rollback')(function* ({ dryRun }) {
    const upgrades = yield* Upgrades;
    yield* Console.log(
      JSON.stringify(yield* upgrades.rollback(dryRun), null, 2),
    );
  }),
).pipe(
  Command.withDescription('Restore the verified previous stable release.'),
);

/** Stable-release administration; normal users ask their current agent to act. */
export const upgradeCommand = Command.make('upgrade').pipe(
  Command.withDescription(
    'Check, install, or roll back a verified stable release.',
  ),
  Command.withSubcommands([status, check, apply, rollback]),
);
