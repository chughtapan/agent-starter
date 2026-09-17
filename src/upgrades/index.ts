/**
 * @file Exposes stable release administration and its package boundary.
 */

/** Typed release policy and package distribution boundaries. */
export { ReleasePackages, Upgrades } from './ports.js';
/** Production release distribution and executable verification. */
export { releasePackagesLayer } from './releases.js';
/** Production stable release policy, activation, and recovery. */
export { upgradesLayer } from './service.js';
