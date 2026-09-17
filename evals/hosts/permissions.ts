/**
 * @file Prepares explicit native grants inside disposable evaluation profiles.
 */

import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';

import { Check, EvaluationError, type Profile } from '../domain/index.js';

const ObjectValue = Schema.Record(Schema.String, Schema.Unknown);
const PermissionRules = Schema.Struct({
  allow: Schema.optionalKey(Schema.Array(Schema.String)),
  ask: Schema.optionalKey(Schema.Array(Schema.String)),
  deny: Schema.optionalKey(Schema.Array(Schema.String)),
  defaultMode: Schema.optionalKey(Schema.String),
});
const COMMANDS = [
  'context',
  'updates',
  'items',
  'present',
  'request',
  'reply',
  'done',
  'triage',
  'onboard',
  'doctor',
];

const readClaudePermissions = Effect.fn('evals.readClaudePermissions')(
  function* (profile: Profile) {
    const fs = yield* FileSystem.FileSystem;
    const settingsPath = `${profile.native}/settings.json`;
    const settings = (yield* fs.exists(settingsPath))
      ? yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ObjectValue))(
          yield* fs.readFileString(settingsPath),
        )
      : {};
    const permissions = yield* Schema.decodeUnknownEffect(ObjectValue)(
      settings.permissions ?? {},
    );
    const rules =
      yield* Schema.decodeUnknownEffect(PermissionRules)(permissions);
    return { settingsPath, settings, permissions, rules };
  },
);

const claudeGrants = Effect.fn('evals.claudeGrants')(function* (
  profile: Profile,
) {
  const path = yield* Path.Path;
  const launcher = path.join(
    path.dirname(path.dirname(profile.home)),
    'bin',
    'social-harness',
  );
  const escapedHome = profile.home.replace(/[\\*?[\]!]/g, '\\$&');
  return [
    // Claude checks both Write and Edit calls against Edit path rules.
    `Edit(/${escapedHome}/**)`,
    ...['social-harness', launcher].flatMap((executable) =>
      COMMANDS.map((command) => `Bash(${executable} ${command} *)`),
    ),
  ];
});

/** Adds only named command grants and writes within the disposable Claude home. */
export const prepareNativePermissions = Effect.fn(
  'evals.prepareNativePermissions',
)(
  function* (profile: Profile) {
    if (profile.host !== 'claude') {
      return;
    }
    const fs = yield* FileSystem.FileSystem;
    const existing = yield* readClaudePermissions(profile);
    const ownedAllow = yield* claudeGrants(profile);
    yield* fs.writeFileString(
      existing.settingsPath,
      `${JSON.stringify(
        {
          ...existing.settings,
          permissions: {
            ...existing.permissions,
            allow: [
              ...new Set([...(existing.rules.allow ?? []), ...ownedAllow]),
            ],
          },
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    yield* fs.writeFileString(
      `${profile.home}/native-permissions.json`,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          host: profile.host,
          path: existing.settingsPath,
          ownedAllow,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
  },
  Effect.mapError(() =>
    EvaluationError.make({
      operation: 'native-permissions',
      reason:
        'Could not preserve and prepare the isolated native permission settings. Check their JSON structure and file access.',
    }),
  ),
);

/** Reports configured grants separately from permission success in live tools. */
export const checkNativePermissions = Effect.fn('evals.checkNativePermissions')(
  function* (profile: Profile) {
    if (profile.host === 'codex') {
      return Check.make({
        name: 'codex:permission-policy',
        status: 'pass',
        detail:
          'Every new and resumed Codex invocation enables outbound network access within workspace-write; profile configuration and approval rules remain intact.',
      });
    }
    const { rules } = yield* readClaudePermissions(profile);
    const required = yield* claudeGrants(profile);
    const missing = required.filter((rule) => !rules.allow?.includes(rule));
    const restrictions = [...(rules.ask ?? []), ...(rules.deny ?? [])];
    const blocked = restrictions.some(
      (rule) =>
        ['*', 'Bash', 'Bash(*)', 'Edit', 'Write', 'Read'].includes(rule) ||
        required.includes(rule),
    );
    const bypass = rules.defaultMode === 'bypassPermissions';
    let detail = `Required home-scoped Edit and named Social Harness command grants are present. ${restrictions.length} existing ask/deny rules remain active; actual tool denials still block a live run.`;
    if (missing.length > 0) {
      detail = `${missing.length} required isolated file or named command grants are absent; run --prepare. The valid Edit rule covers native Write and Edit calls.`;
    } else if (blocked || bypass) {
      detail =
        'The isolated profile has a conflicting broad ask/deny rule or a permission bypass mode. Preserve and review those settings before execution.';
    }
    return Check.make({
      name: 'claude:permission-grants',
      status: missing.length === 0 && !blocked && !bypass ? 'pass' : 'blocked',
      detail,
    });
  },
  Effect.catch(() =>
    Effect.succeed(
      Check.make({
        name: 'claude:permission-grants',
        status: 'blocked',
        detail:
          'Isolated native permission settings could not be read or decoded; check their JSON structure and file access.',
      }),
    ),
  ),
);
