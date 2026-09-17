/**
 * @file Defines the public migration API.
 */

/** Supported migration operations and contracts. */
export {
  isOwnedLegacyEntry,
  Migration,
  migrationLayer,
  parseLegacyIdentity,
  rewriteLegacyLabels,
} from './service.js';
