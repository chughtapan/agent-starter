/**
 * @file Renders collaboration updates and controls when the board is due.
 */

import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

import { Configuration } from './config.js';
import {
  type CollaborationUpdate,
  MailboxCache,
  PresentationState,
  type UpdateKind,
} from './domain/collaboration.js';
import {
  type ConfigurationError,
  type MailboxError,
  StorageError,
} from './errors.js';
import { Mailbox } from './mailbox.js';
import { Paths } from './paths.js';
import { Storage } from './storage.js';

const DISPLAY_KINDS: Readonly<Record<UpdateKind, string>> = {
  needsYou: 'NEEDS YOU',
  ready: 'READY',
  waiting: 'WAITING',
  working: 'WORKING',
  failed: 'FAILED',
};

/** Result of checking the collaboration update board. */
interface BoardResult {
  readonly updates: readonly CollaborationUpdate[];
  readonly rendered: string;
  readonly shouldPresent: boolean;
  readonly source: 'fresh' | 'cache';
  readonly warning?: string;
}

/** Provides update synchronization and presentation policy. */
export interface BoardService {
  readonly check: (
    force?: boolean,
    present?: boolean,
  ) => Effect.Effect<
    BoardResult,
    ConfigurationError | MailboxError | StorageError
  >;
}

/** Identifies the user-facing update board service. */
export class Board extends Context.Service<Board, BoardService>()(
  'social-harness/Board',
) {}

/**
 * Formats updates without exposing sessions or implementation details.
 * @param updates Current collaboration updates in display order.
 * @param now Current epoch time used to calculate waiting age.
 * @returns The compact update board shown in the active conversation.
 */
export function renderBoard(
  updates: readonly CollaborationUpdate[],
  now: number,
): string {
  if (updates.length === 0) {
    return 'UPDATES\nALL CLEAR';
  }
  const lines = updates.map((update) => {
    const age =
      update.kind === 'waiting' || update.kind === 'working'
        ? ` · ${elapsed(update.updatedAt, now)}`
        : '';
    return `${DISPLAY_KINDS[update.kind].padEnd(9)} ${displayName(
      update.collaborator,
    )} · ${update.summary}${age}`;
  });
  return ['UPDATES', ...lines].join('\n');
}

function displayName(value: string): string {
  const openBracket = value.indexOf('<');
  const closeBracket = value.indexOf('>', openBracket + 1);
  const hasBracketedAddress =
    openBracket >= 0 && closeBracket > openBracket + 1;
  const named = hasBracketedAddress
    ? value.slice(0, openBracket).trim()
    : undefined;
  const address = hasBracketedAddress
    ? value.slice(openBracket + 1, closeBracket)
    : value;
  const localPart = address.split('@')[0]?.trim();
  const specificName = named?.toLowerCase() === 'agentmail' ? undefined : named;
  return (
    [specificName, localPart].find(
      (candidate) => candidate !== undefined && candidate.length > 0,
    ) ?? value
  );
}

function elapsed(value: string, now: number): string {
  const milliseconds = Math.max(0, now - Date.parse(value));
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 24
    ? `${String(hours)}h`
    : `${String(Math.floor(hours / 24))}d`;
}

function durationMilliseconds(value: string): number {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (match === null) {
    return 0;
  }
  return (
    Number(match[1] ?? '0') * 3_600_000 +
    Number(match[2] ?? '0') * 60_000 +
    Number(match[3] ?? '0') * 1_000
  );
}

function signature(updates: readonly CollaborationUpdate[]): string {
  return updates
    .map((update) => `${update.messageId}:${update.kind}:${update.updatedAt}`)
    .sort((left, right) => left.localeCompare(right))
    .join('|');
}

/** Provides the compact board with change and staleness presentation rules. */
export const boardLayer = Layer.effect(Board)(
  Effect.gen(function* () {
    const mailbox = yield* Mailbox;
    const paths = yield* Paths;
    const storage = yield* Storage;
    const configuration = yield* Configuration;

    const readCache = Effect.fn('Board.readCache')(function* () {
      const path = paths.cache;
      const input = yield* storage.readJson(path);
      if (input === undefined) {
        return undefined;
      }
      return yield* Schema.decodeUnknownEffect(MailboxCache)(input).pipe(
        Effect.mapError((cause) =>
          StorageError.make({ operation: 'decodeJson', path, cause }),
        ),
      );
    });

    const readPresentation = Effect.fn('Board.readPresentation')(function* () {
      const path = paths.presentation;
      const input = yield* storage.readJson(path);
      if (input === undefined) {
        return undefined;
      }
      return yield* Schema.decodeUnknownEffect(PresentationState)(input).pipe(
        Effect.mapError((cause) =>
          StorageError.make({ operation: 'decodeJson', path, cause }),
        ),
      );
    });

    const check = Effect.fn('Board.check')(function* (
      force?: boolean,
      present?: boolean,
    ) {
      const shouldForce = force ?? false;
      const shouldConsiderPresentation = present ?? true;
      const now = yield* Clock.currentTimeMillis;
      const config = yield* configuration.load();
      const cached = yield* readCache();
      const syncResult = yield* mailbox.syncUpdates().pipe(Effect.result);
      const updates =
        syncResult._tag === 'Success'
          ? syncResult.success
          : (cached?.updates ?? []);
      const source: BoardResult['source'] =
        syncResult._tag === 'Success' ? 'fresh' : 'cache';
      let warning: string | undefined;
      if (syncResult._tag === 'Failure') {
        warning =
          syncResult.failure._tag === 'MailboxError'
            ? syncResult.failure.reason
            : `${syncResult.failure.operation} failed at ${syncResult.failure.path}`;
      }

      if (syncResult._tag === 'Success') {
        yield* storage.writeJson(
          paths.cache,
          MailboxCache.make({
            schemaVersion: 1,
            lastSync: new Date(now).toISOString(),
            updates,
          }),
        );
      }

      const presentation = yield* readPresentation();
      const currentSignature = signature(updates);
      const stale =
        presentation === undefined ||
        now - Date.parse(presentation.lastPresentedAt) >=
          durationMilliseconds(config.updates.staleAfter);
      const hasPresentationChange =
        presentation === undefined ||
        presentation.lastSignature !== currentSignature;
      const shouldPresent: boolean =
        shouldConsiderPresentation &&
        (shouldForce || hasPresentationChange || stale);

      if (shouldPresent) {
        yield* mailbox
          .markPresented(updates.map((update) => update.messageId))
          .pipe(Effect.catch(() => Effect.void));
        yield* storage.writeJson(
          paths.presentation,
          PresentationState.make({
            schemaVersion: 1,
            lastSignature: currentSignature,
            lastPresentedAt: new Date(now).toISOString(),
          }),
        );
      }

      return {
        updates,
        rendered: renderBoard(updates, now),
        shouldPresent,
        source,
        ...(warning === undefined ? {} : { warning }),
      } satisfies BoardResult;
    });

    return { check };
  }).pipe(Effect.withSpan('boardLayer')),
);
