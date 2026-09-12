/**
 * @file Repeats host-neutral mailbox synchronization on a validated schedule.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schedule from 'effect/Schedule';

import type {
  ConfigurationError,
  MailboxError,
  StorageError,
} from './errors.js';
import { Board } from './board.js';
import { Configuration } from './config.js';
import { HarnessEvent } from './domain/runtime.js';
import { Paths } from './paths.js';
import { Storage } from './storage.js';

/** Provides the single host-neutral mailbox polling loop. */
export interface PollerService {
  readonly once: () => Effect.Effect<
    void,
    ConfigurationError | MailboxError | StorageError
  >;
  readonly run: () => Effect.Effect<
    never,
    ConfigurationError | MailboxError | StorageError
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
    });

    const run = Effect.fn('Poller.run')(function* () {
      const config = yield* configuration.load();
      yield* once();
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
