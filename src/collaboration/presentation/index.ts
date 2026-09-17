/**
 * @file Defines the public presentation API.
 */

/** Supported presentation operations and contracts. */
export { boardLayer, renderBoard } from './board.js';
/** Supported presentation operations and contracts. */
export { receiptsLayer } from './receipts.js';
/** Public service contracts do not depend on their implementations. */
export { Board, PresentationError, Receipts } from './api/index.js';
