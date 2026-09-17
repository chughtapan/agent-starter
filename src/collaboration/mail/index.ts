/**
 * @file Defines the public mail API.
 */

/** Supported mail operations and contracts. */
export {
  classifyUpdateKind,
  isCollaborationSubject,
  Mailbox,
  mailboxLayer,
  MESSAGE_LABELS,
  selectLatestMessage,
  THREAD_LABELS,
} from './service.js';
/** Expected failures reported by this module. */
export { MailboxError } from './errors.js';
/** Supported mail operations and contracts. */
export {
  type MailboxLabelRewrite,
  type MailboxLabelSnapshot,
} from './service.js';
