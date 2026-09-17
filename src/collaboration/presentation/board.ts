/**
 * @file Renders collaboration updates and controls when the board is due.
 */

import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

import {
  type CollaborationUpdate,
  MailboxCache,
  type UpdateKind,
} from '../../domain/collaboration.js';
import { Configuration } from '../../platform/configuration/index.js';
import {
  Paths,
  Storage,
  StorageError,
} from '../../platform/persistence/index.js';
import { Mailbox, MailboxError } from '../mail/index.js';
import {
  Board,
  type BoardResult,
  PresentationError,
  Receipts,
} from './api/index.js';

const DISPLAY_KINDS: Readonly<Record<UpdateKind, string>> = {
  needsYou: 'NEEDS YOU',
  ready: 'READY',
  waiting: 'WAITING',
  working: 'WORKING',
  failed: 'FAILED',
};

/**
 * Formats updates without exposing sessions or implementation details.
 * @param updates Current collaboration updates in display order.
 * @param now Current epoch time used to calculate waiting age.
 * @param characterSet Separator profile for the owner's terminal.
 * @returns The compact update board shown in the active conversation.
 */
export function renderBoard(
  updates: readonly CollaborationUpdate[],
  now: number,
  characterSet: 'auto' | 'unicode' | 'ascii' = 'auto',
): string {
  if (updates.length === 0) {
    return 'UPDATES\nALL CLEAR';
  }
  const separator = characterSet === 'ascii' ? ' - ' : ' · ';
  const clean = (value: string) =>
    value
      .replaceAll(/[\p{Cc}\p{Cf}]/gu, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
  const lines = updates.map((update) => {
    const age =
      update.kind === 'waiting' || update.kind === 'working'
        ? `${separator}${elapsed(update.updatedAt, now)}`
        : '';
    return `${DISPLAY_KINDS[update.kind].padEnd(9)} ${clean(
      displayName(update.collaborator),
    )}${separator}${clean(update.summary)}${age}`;
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
    .map((update) =>
      JSON.stringify([
        update.messageId,
        update.kind,
        update.updatedAt,
        update.collaborator,
        update.summary,
      ]),
    )
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
    const receipts = yield* Receipts;

    const readCache = Effect.fn('Board.readCache')(function* () {
      const path = paths.cache;
      const input = yield* storage.readJson(path);
      if (input === undefined) {
        return undefined;
      }
      return yield* Schema.decodeUnknownEffect(MailboxCache)(input).pipe(
        Effect.mapError(() =>
          StorageError.make({ operation: 'decodeJson', path }),
        ),
      );
    });

    const check = Effect.fn('Board.check')(function* (
      force?: boolean,
      present?: boolean,
      refresh = true,
    ) {
      const shouldForce = force ?? false;
      const shouldConsiderPresentation = present ?? true;
      const now = yield* Clock.currentTimeMillis;
      const config = yield* configuration.load();
      const cached = yield* readCache().pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );
      const syncResult = yield* (
        refresh
          ? mailbox.syncUpdates().pipe(
              Effect.timeoutOrElse({
                duration: '5 seconds',
                orElse: () =>
                  Effect.fail(
                    MailboxError.make({
                      operation: 'sync',
                      reason: 'mailbox check timed out',
                    }),
                  ),
              }),
            )
          : Effect.succeed(cached?.updates ?? [])
      ).pipe(Effect.result);
      const updates =
        syncResult._tag === 'Success'
          ? syncResult.success
          : (cached?.updates ?? []);
      const source: BoardResult['source'] =
        syncResult._tag === 'Success' && refresh ? 'fresh' : 'cache';
      let warning: string | undefined;
      if (syncResult._tag === 'Failure') {
        warning =
          syncResult.failure._tag === 'MailboxError'
            ? syncResult.failure.reason
            : `${syncResult.failure.operation} failed at ${syncResult.failure.path}`;
      }

      if (syncResult._tag === 'Success' && refresh) {
        yield* storage.writeJson(
          paths.cache,
          MailboxCache.make({
            schemaVersion: 1,
            lastSync: new Date(now).toISOString(),
            updates,
          }),
        );
      }

      const presentation = yield* receipts.read();
      const unpresentedMessageIds = updates
        .filter(
          (update) =>
            (update.kind === 'ready' || update.kind === 'needsYou') &&
            !(presentation?.visibleMessageIds ?? []).includes(update.messageId),
        )
        .map((update) => update.messageId);
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
        (shouldForce ||
          hasPresentationChange ||
          stale ||
          unpresentedMessageIds.length > 0);
      const rendered =
        cached === undefined && source === 'cache'
          ? 'UPDATES\nUNAVAILABLE'
          : renderBoard(updates, now, config.updates.characterSet);
      const receipt = shouldPresent
        ? yield* receipts.issue(
            currentSignature,
            updates.map((update) => update.messageId),
            rendered,
          )
        : undefined;

      return {
        updates,
        rendered,
        shouldPresent,
        source,
        unpresentedMessageIds,
        ...(receipt === undefined ? {} : { receipt }),
        ...(warning === undefined ? {} : { warning }),
      } satisfies BoardResult;
    });

    return Board.of({
      check: (force, present, refresh) =>
        check(force, present, refresh).pipe(
          Effect.mapError(() =>
            PresentationError.make({
              operation: 'updates',
              reason: 'updates could not be retrieved',
            }),
          ),
        ),
    });
  }).pipe(Effect.withSpan('boardLayer')),
);
