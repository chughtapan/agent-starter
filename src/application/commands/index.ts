/**
 * @file Defines the public commands API.
 */

/** Supported commands operations and contracts. */
export {
  contextCommand,
  hostHookCommand,
  presentCommand,
  presentedCommand,
} from './host.js';
/** Supported commands operations and contracts. */
export { doctorCommand } from './diagnostics.js';
/** Agent-operated stable software release inspection and control. */
export { upgradeCommand } from './upgrades.js';
