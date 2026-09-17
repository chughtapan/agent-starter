/**
 * @file Verifies collaboration discovery and message-first state precedence.
 */

import { assert, describe, it } from '@effect/vitest';
import { FastCheck } from 'effect/testing';

import {
  classifyUpdateKind,
  isCollaborationSubject,
  MESSAGE_LABELS,
  selectLatestMessage,
  THREAD_LABELS,
} from '../../src/collaboration/mail/index.js';

describe('mailbox state', () => {
  it('requires explicit done and lets done win over other labels', () => {
    assert.isUndefined(
      classifyUpdateKind(
        new Set([MESSAGE_LABELS.done, MESSAGE_LABELS.ready]),
        new Set([THREAD_LABELS.failed]),
        true,
        true,
      ),
    );
  });

  it('keeps triaged inbound work unread and ready', () => {
    assert.strictEqual(
      classifyUpdateKind(
        new Set([MESSAGE_LABELS.triaged, 'unread']),
        new Set([THREAD_LABELS.collaboration]),
        true,
        true,
      ),
      'ready',
    );
  });

  it('uses message states before thread states', () => {
    assert.strictEqual(
      classifyUpdateKind(
        new Set([MESSAGE_LABELS.needsYou]),
        new Set([THREAD_LABELS.waiting]),
        true,
        true,
      ),
      'needsYou',
    );
  });

  it('reopens a waiting thread when a new unread reply arrives', () => {
    assert.strictEqual(
      classifyUpdateKind(
        new Set(['unread']),
        new Set([THREAD_LABELS.collaboration, THREAD_LABELS.waiting]),
        true,
        true,
      ),
      'ready',
    );
  });

  it('discovers collaboration subjects across inboxes', () => {
    assert.isTrue(isCollaborationSubject('[COLLAB] failure trace'));
    assert.isTrue(isCollaborationSubject('Re: [INTRO] alice-agent'));
    assert.isFalse(isCollaborationSubject('ordinary project status'));
  });

  it('orders messages by delivery rather than later label edits', () => {
    const sent = {
      id: 'sent',
      timestamp: '2026-08-18T07:37:08.453Z',
      updated_at: '2026-08-28T03:12:32.259Z',
    };
    const reply = {
      id: 'reply',
      timestamp: '2026-08-18T08:33:26.000Z',
      updated_at: '2026-08-28T03:10:17.885Z',
    };

    assert.strictEqual(selectLatestMessage([sent, reply]), reply);
  });

  it.prop(
    'never reopens a message whose owner marked it done',
    [
      FastCheck.uniqueArray(
        FastCheck.constantFrom(
          THREAD_LABELS.collaboration,
          THREAD_LABELS.failed,
          THREAD_LABELS.waiting,
          THREAD_LABELS.working,
        ),
      ),
      FastCheck.boolean(),
      FastCheck.boolean(),
    ],
    ([threadLabels, inbound, unread]) =>
      classifyUpdateKind(
        new Set([MESSAGE_LABELS.done]),
        new Set(threadLabels),
        inbound,
        unread,
      ) === undefined,
  );
});
