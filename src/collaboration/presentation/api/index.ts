/**
 * @file Defines presentation services independently of their implementations.
 */

import type * as Effect from 'effect/Effect';
import * as Context from 'effect/Context';
import * as Schema from 'effect/Schema';
import type { CollaborationUpdate } from '../../../domain/collaboration.js';
import type {
  PresentationAcknowledgement,
  PresentationState,
} from '../../../domain/presentation.js';
import type { AdapterProbe } from '../../../domain/runtime.js';

/** Visibility could not be retrieved or durably acknowledged. */
export class PresentationError extends Schema.TaggedErrorClass<PresentationError>()(
  'PresentationError',
  {
    operation: Schema.String,
    reason: Schema.String,
  },
) {
  override get message(): string {
    return `${this.operation}: ${this.reason}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}

/** Result of checking the collaboration update board. */
export interface BoardResult {
  readonly updates: readonly CollaborationUpdate[];
  readonly rendered: string;
  readonly shouldPresent: boolean;
  readonly source: 'fresh' | 'cache';
  readonly warning?: string;
  readonly receipt?: string;
  readonly unpresentedMessageIds: readonly string[];
}

/** Provides update synchronization and presentation policy. */
export interface BoardService {
  readonly check: (
    force?: boolean,
    present?: boolean,
    refresh?: boolean,
  ) => Effect.Effect<BoardResult, PresentationError>;
}

/** Identifies the user-facing update board service. */
export class Board extends Context.Service<Board, BoardService>()(
  'social-harness/Board',
) {}

/** Identifies an immutable draft awaiting matching native assistant output. */
interface PreparedPresentation {
  readonly requestId: string;
  readonly receiptId: string;
  readonly host: 'claude' | 'codex';
  readonly draftTextHash: string;
}

/** Provides durable snapshot and visible-message acknowledgements. */
export class Receipts extends Context.Service<
  Receipts,
  {
    readonly read: (
      host?: AdapterProbe['name'],
    ) => Effect.Effect<PresentationState | undefined, PresentationError>;
    readonly issue: (
      signature: string,
      messageIds: readonly string[],
      rendered?: string,
    ) => Effect.Effect<string, PresentationError>;
    readonly acknowledge: (
      receipt: string,
      messageIds: readonly string[],
      host?: AdapterProbe['name'],
    ) => Effect.Effect<void, PresentationError>;
    readonly prepare: (
      receiptId: string,
      host: 'claude' | 'codex',
      draftText: string,
      messageIds: readonly string[],
    ) => Effect.Effect<PreparedPresentation, PresentationError>;
    readonly confirm: (
      host: 'claude' | 'codex',
      lastAssistantMessage: string,
    ) => Effect.Effect<
      readonly PresentationAcknowledgement[],
      PresentationError
    >;
  }
>()('social-harness/Receipts') {}
