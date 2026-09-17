/**
 * @file Defines stable update policy and release package service contracts.
 */

import type * as Effect from 'effect/Effect';

import * as Context from 'effect/Context';

import type {
  ReleaseManifest,
  UpgradeError,
  UpgradeStatus,
} from '../domain/upgrades.js';

/** The existing poller calls checkIfDue; no separate software-update timer exists. */
export interface UpgradesService {
  readonly recover: () => Effect.Effect<
    UpgradeStatus | undefined,
    UpgradeError
  >;
  readonly status: () => Effect.Effect<UpgradeStatus, UpgradeError>;
  readonly check: () => Effect.Effect<UpgradeStatus, UpgradeError>;
  readonly apply: () => Effect.Effect<UpgradeStatus, UpgradeError>;
  readonly rollback: (
    dryRun?: boolean,
  ) => Effect.Effect<UpgradeStatus, UpgradeError>;
  readonly checkIfDue: () => Effect.Effect<UpgradeStatus, UpgradeError>;
}

/** Stable software release administration under the user's configured policy. */
export class Upgrades extends Context.Service<Upgrades, UpgradesService>()(
  'social-harness/Upgrades',
) {}

/** Fixed GitHub metadata, private npm staging, and executable verification. */
export class ReleasePackages extends Context.Service<
  ReleasePackages,
  {
    readonly runningVersion: () => Effect.Effect<string, UpgradeError>;
    readonly latest: () => Effect.Effect<
      ReleaseManifest | undefined,
      UpgradeError
    >;
    readonly stage: (
      manifest: ReleaseManifest,
      stagingRoot: string,
    ) => Effect.Effect<string, UpgradeError>;
    readonly verify: (
      packageRoot: string,
      version: string,
      scratchRoot: string,
    ) => Effect.Effect<void, UpgradeError>;
    readonly repair: (cliPath: string) => Effect.Effect<void, UpgradeError>;
  }
>()('social-harness/ReleasePackages') {}
