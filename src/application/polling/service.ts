/**
 * @file Repeats host-neutral mailbox synchronization on a validated schedule.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schedule from 'effect/Schedule';

import {
  Board,
  type PresentationError,
} from '../../collaboration/presentation/index.js';
import { HarnessEvent } from '../../domain/runtime.js';
import {
  Configuration,
  type ConfigurationError,
} from '../../platform/configuration/index.js';
import {
  Paths,
  Storage,
  type StorageError,
} from '../../platform/persistence/index.js';
import { Upgrades } from '../../upgrades/index.js';

/** Provides the single host-neutral mailbox polling loop. */
export interface PollerService {
  readonly once: () => Effect.Effect<
    void,
    ConfigurationError | PresentationError | StorageError
  >;
  readonly run: () => Effect.Effect<
    never,
    ConfigurationError | PresentationError | StorageError
  >;
}

/** Identifies background collaboration polling. */
export class Poller extends Context.Service<Poller, PollerService>()(
  'social-harness/Poller',
) {}

function durationMilliseconds(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (match === null) {
    return 60_000;
  }
  return (
    Number(match[1] ?? '0') * 3_600_000 +
    Number(match[2] ?? '0') * 60_000 +
    Number(match[3] ?? '0') * 1_000
  );
}

/** Uses Effect Schedule so suspend and resume inherit host clock semantics. */
export const pollerLayer = Layer.effect(Poller)(
  Effect.gen(function* () {
    const board = yield* Board;
    const paths = yield* Paths;
    const storage = yield* Storage;
    const configuration = yield* Configuration;
    const upgrades = yield* Upgrades;

    const once = Effect.fn('Poller.once')(function* () {
      const result = yield* board.check(false, false);
      yield* storage.appendEvent(
        paths.events,
        HarnessEvent.make({
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          type: 'mailbox.polled',
          details: {
            openUpdates: result.updates.length,
            source: result.source,
          },
        }),
      );
      yield* upgrades.checkIfDue().pipe(Effect.ignore);
    });

    const run = Effect.fn('Poller.run')(function* () {
      const config = yield* configuration.load();
      return yield* once().pipe(
        Effect.repeat(
          Schedule.spaced(durationMilliseconds(config.polling.interval)),
        ),
        Effect.flatMap(() => Effect.never),
      );
    });

    return { once, run };
  }).pipe(Effect.withSpan('pollerLayer')),
);
