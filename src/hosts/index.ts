/**
 * @file Defines the public hosts API.
 */

/** Supported hosts operations and contracts. */
export {
  Adapters,
  adaptersLayer,
  addSessionHook,
  hasSessionHook,
} from './adapters.js';
/** Supported hosts operations and contracts. */
export { Scheduler, schedulerLayer } from './scheduler.js';
/** Expected failures reported by this module. */
export { AdapterError, SchedulerError } from './errors.js';
