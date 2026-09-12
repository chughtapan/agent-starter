/**
 * @file Defines the versioned user configuration and installation defaults.
 */

import * as Schema from 'effect/Schema';

const IsoDuration = Schema.String.check(
  Schema.isPattern(/^PT(?=.*[1-9])(?:\d+H)?(?:\d+M)?(?:\d+S)?$/),
);

class AdapterConfig extends Schema.Class<AdapterConfig>('AdapterConfig')({
  mode: Schema.Literals(['auto', 'enabled', 'disabled']),
}) {}

class PollingConfig extends Schema.Class<PollingConfig>('PollingConfig')({
  interval: IsoDuration,
}) {}

class UpdatesConfig extends Schema.Class<UpdatesConfig>('UpdatesConfig')({
  profile: Schema.Literals(['compact', 'singleLine', 'detailed']),
  staleAfter: IsoDuration,
  characterSet: Schema.Literals(['auto', 'unicode', 'ascii']),
}) {}

class NotificationsConfig extends Schema.Class<NotificationsConfig>(
  'NotificationsConfig',
)({
  enabled: Schema.Boolean,
  openHost: Schema.String,
}) {}

class ExecutionConfig extends Schema.Class<ExecutionConfig>('ExecutionConfig')({
  preferredAdapter: Schema.Literals(['auto', 'claude', 'codex', 'openClaw']),
}) {}

class BackupConfig extends Schema.Class<BackupConfig>('BackupConfig')({
  gitExport: Schema.Literals(['disabled', 'enabled']),
}) {}

/** Defines the complete, versioned user configuration file. */
export class HarnessConfig extends Schema.Class<HarnessConfig>('HarnessConfig')(
  {
    schemaVersion: Schema.Literal(1),
    polling: PollingConfig,
    updates: UpdatesConfig,
    notifications: NotificationsConfig,
    execution: ExecutionConfig,
    adapters: Schema.Struct({
      claude: AdapterConfig,
      codex: AdapterConfig,
      openClaw: AdapterConfig,
    }),
    backup: BackupConfig,
  },
) {}

/**
 * Returns the stable defaults used by a new installation.
 * @returns A validated version-one configuration value.
 */
export function makeDefaultConfig(): HarnessConfig {
  return HarnessConfig.make({
    schemaVersion: 1,
    polling: PollingConfig.make({ interval: 'PT15M' }),
    updates: UpdatesConfig.make({
      profile: 'compact',
      staleAfter: 'PT1H',
      characterSet: 'auto',
    }),
    notifications: NotificationsConfig.make({
      enabled: true,
      openHost: 'auto',
    }),
    execution: ExecutionConfig.make({ preferredAdapter: 'auto' }),
    adapters: {
      claude: AdapterConfig.make({ mode: 'auto' }),
      codex: AdapterConfig.make({ mode: 'auto' }),
      openClaw: AdapterConfig.make({ mode: 'auto' }),
    },
    backup: BackupConfig.make({ gitExport: 'disabled' }),
  });
}
