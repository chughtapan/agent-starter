/**
 * @file Owns all earlier-format detection, conversion, and clean removal.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';
import * as Predicate from 'effect/Predicate';
import * as Schema from 'effect/Schema';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';

import {
  Mailbox,
  type MailboxError,
  type MailboxLabelRewrite,
  type MailboxLabelSnapshot,
  MESSAGE_LABELS,
  THREAD_LABELS,
} from '../../collaboration/mail/index.js';
import { makeDefaultConfig } from '../../domain/configuration.js';
import { AgentIdentity } from '../../domain/identity.js';
import {
  type AdapterError,
  Adapters,
  Scheduler,
  type SchedulerError,
} from '../../hosts/index.js';
import {
  Configuration,
  type ConfigurationError,
} from '../../platform/configuration/index.js';
import {
  DocumentTemplates,
  type TemplateError,
} from '../../platform/documents/index.js';
import {
  Paths,
  Storage,
  StorageError,
} from '../../platform/persistence/index.js';

/** Migration found user-owned data that prevents automatic cleanup. */
class MigrationBlockedError extends Schema.TaggedErrorClass<MigrationBlockedError>()(
  'MigrationBlockedError',
  {
    reasons: Schema.Array(Schema.String),
  },
) {
  override get message(): string {
    return `Migration blocked: ${this.reasons.join('; ')}`
      .replaceAll(/[\p{Cc}\p{Cf}]+/gu, ' ')
      .trim();
  }
}

const EXPECTED_LEGACY_ENTRIES = new Set([
  '.agent-kit',
  '.agents',
  '.claude',
  '.git',
  '.gitignore',
  '.mcp.json',
  'AGENTS.md',
  'CLAUDE.md',
  'LICENSE',
  'PROTOCOL.md',
  'README.md',
  'VERSION',
  'assets',
  'bin',
  'docs',
  'proposals',
  'roster.md',
  'status.md',
  'team',
  'test',
]);

const LEGACY_LABELS = {
  introductionSent: 'intro-sent',
  needsHuman: 'needs-human',
  ownerAnswered: 'owner-answered',
  ownerMailed: 'owner-mailed',
  processed: 'processed',
  replied: 'replied',
};

const LEGACY_LABEL_NAMES = Object.values(LEGACY_LABELS);

/**
 * Reports whether the earlier product owned a top-level clone entry.
 * @param name One top-level file or directory name.
 * @returns Whether clean migration may remove the entry with the clone.
 */
export function isOwnedLegacyEntry(name: string): boolean {
  return EXPECTED_LEGACY_ENTRIES.has(name);
}

/** Describes one artifact considered by clean migration. */
class LegacyArtifact extends Schema.Class<LegacyArtifact>('LegacyArtifact')({
  kind: Schema.Literals([
    'identity',
    'roster',
    'status',
    'norm',
    'hook',
    'skill',
    'mcp',
    'poller',
    'state',
    'clone',
    'label',
  ]),
  path: Schema.String,
  action: Schema.Literals(['migrate', 'remove', 'preserve', 'blocked']),
  reason: Schema.String,
}) {}

/** Records the inspected migration plan before any destructive cleanup. */
class MigrationPlan extends Schema.Class<MigrationPlan>('MigrationPlan')({
  schemaVersion: Schema.Literal(1),
  sourceRepo: Schema.String,
  productSource: Schema.Boolean,
  clean: Schema.Boolean,
  artifacts: Schema.Array(LegacyArtifact),
  blockers: Schema.Array(Schema.String),
}) {}

/**
 * Extracts canonical identity fields from an earlier Markdown identity.
 * @param content Earlier installed identity document.
 * @returns A validated current identity, or undefined when decoding is unsafe.
 */
export function parseLegacyIdentity(
  content: string,
): AgentIdentity | undefined {
  const flattened = content
    .split('\n')
    .map((line) => line.trim())
    .join(' ');
  const agentName = between(flattened, 'I am **', '**');
  const ownerName = between(flattened, 'an AI agent run by **', '**');
  const facilitatorName = between(flattened, 'Facilitator: **', '**');
  const candidate = {
    agentName,
    agentEmail: between(flattened, 'My inbox is **', '**'),
    ownerName,
    ownerEmail:
      ownerName === undefined
        ? undefined
        : between(flattened, `run by **${ownerName}** <`, '>'),
    purpose: lineValue(content, 'Purpose'),
    since: lineValue(content, 'Since'),
    autonomy: lineValue(content, 'Autonomy'),
    role: lineValue(content, 'Role'),
    facilitatorName,
    facilitatorEmail:
      facilitatorName === undefined
        ? undefined
        : between(flattened, `Facilitator: **${facilitatorName}** <`, '>'),
  };
  return Option.getOrUndefined(
    Schema.decodeUnknownOption(AgentIdentity)(candidate),
  );
}

/**
 * Translates one earlier mailbox state into the current label contract.
 * @param snapshot Current thread identifier and its complete label set.
 * @returns The required label rewrite, or undefined for unrelated state.
 */
export function rewriteLegacyLabels(
  snapshot: MailboxLabelSnapshot,
): MailboxLabelRewrite | undefined {
  const present = LEGACY_LABEL_NAMES.filter((label) =>
    snapshot.threadLabels.has(label),
  );
  if (present.length === 0) {
    return undefined;
  }

  const isWaiting =
    snapshot.threadLabels.has(LEGACY_LABELS.introductionSent) &&
    !snapshot.threadLabels.has(LEGACY_LABELS.processed);
  const needsOwner = snapshot.threadLabels.has(LEGACY_LABELS.needsHuman);
  const isComplete =
    snapshot.threadLabels.has(LEGACY_LABELS.processed) && !needsOwner;

  return {
    addThreadLabels: [
      THREAD_LABELS.collaboration,
      ...(isWaiting ? [THREAD_LABELS.waiting] : []),
    ],
    removeThreadLabels: present,
    addMessageLabels: [
      ...(needsOwner ? [MESSAGE_LABELS.needsYou] : []),
      ...(isComplete ? [MESSAGE_LABELS.done] : []),
    ],
    removeMessageLabels: [],
  };
}

function canonicalFileArtifact(
  kind: 'roster' | 'status',
  sourcePath: string,
  currentExists: boolean,
  legacyReason: string,
): LegacyArtifact {
  return LegacyArtifact.make({
    kind,
    path: sourcePath,
    action: currentExists ? 'preserve' : 'migrate',
    reason: currentExists
      ? `current runtime ${kind} is authoritative`
      : legacyReason,
  });
}

function between(
  content: string,
  prefix: string,
  suffix: string,
): string | undefined {
  const valueStart = content.indexOf(prefix);
  if (valueStart < 0) {
    return undefined;
  }
  const start = valueStart + prefix.length;
  const end = content.indexOf(suffix, start);
  if (end < start) {
    return undefined;
  }
  const value = content.slice(start, end).trim();
  return value.length === 0 ? undefined : value;
}

function lineValue(content: string, field: string): string | undefined {
  const prefix = `- ${field}:`;
  const line = content
    .split('\n')
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(prefix));
  if (line === undefined) {
    return undefined;
  }
  const value = line.slice(prefix.length).trim();
  return value.length === 0 ? undefined : value;
}

/** Provides a preflighted, all-or-blocked legacy migration. */
export interface MigrationService {
  readonly plan: (
    sourceRepo: string,
  ) => Effect.Effect<MigrationPlan, StorageError>;
  readonly apply: (
    sourceRepo: string,
    deleteSource: boolean,
  ) => Effect.Effect<
    MigrationPlan,
    | AdapterError
    | ConfigurationError
    | MailboxError
    | MigrationBlockedError
    | SchedulerError
    | StorageError
    | TemplateError
  >;
}

/** Identifies clean legacy migration. */
export class Migration extends Context.Service<Migration, MigrationService>()(
  'social-harness/Migration',
) {}

function removeLegacyHooks(value: unknown, sourceRepo: string): unknown {
  const root = asRecord(value);
  const hooks = asRecord(root.hooks);
  const cleanedHooks = Object.fromEntries(
    Object.entries(hooks).flatMap(([event, rawEntries]) => {
      if (!Array.isArray(rawEntries)) {
        return [[event, rawEntries]];
      }
      const entries = rawEntries.flatMap((rawEntry) => {
        const entry = asRecord(rawEntry);
        const commands = asUnknownArray(entry.hooks);
        const filtered = commands.filter((command) => {
          const encoded = JSON.stringify(command);
          return !(
            encoded.includes(`${sourceRepo}/bin/agent-brief`) ||
            encoded.includes(`${sourceRepo}/bin/agent-cron`)
          );
        });
        return filtered.length === 0 ? [] : [{ ...entry, hooks: filtered }];
      });
      return entries.length === 0 ? [] : [[event, entries]];
    }),
  );
  return { ...root, hooks: cleanedHooks };
}

function asRecord(value: unknown): Record<string, unknown> {
  return Predicate.isObject(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function asUnknownArray(value: unknown): readonly unknown[] {
  return Array.isArray(value)
    ? value.map((entry: unknown): unknown => entry)
    : [];
}

/** Implements copy-first migration and only removes inspected legacy artifacts. */
export const migrationLayer = Layer.effect(Migration)(
  Effect.gen(function* () {
    const adapters = yield* Adapters;
    const configuration = yield* Configuration;
    const fileSystem = yield* FileSystem.FileSystem;
    const mailbox = yield* Mailbox;
    const path = yield* Path.Path;
    const paths = yield* Paths;
    const scheduler = yield* Scheduler;
    const storage = yield* Storage;
    const templates = yield* DocumentTemplates;
    const processSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const storageFailure = (operation: string, filename: string) => () =>
      StorageError.make({ operation, path: filename });
    const exists = (filename: string) =>
      fileSystem
        .exists(filename)
        .pipe(Effect.mapError(storageFailure('exists', filename)));
    const info = (filename: string) =>
      fileSystem
        .stat(filename)
        .pipe(Effect.mapError(storageFailure('stat', filename)));
    const entries = (filename: string) =>
      fileSystem
        .readDirectory(filename)
        .pipe(Effect.mapError(storageFailure('readDirectory', filename)));
    const read = (filename: string) =>
      fileSystem
        .readFile(filename)
        .pipe(Effect.mapError(storageFailure('readFile', filename)));
    const isLink = (filename: string) =>
      fileSystem
        .readLink(filename)
        .pipe(Effect.option, Effect.map(Option.isSome));

    const sourceBlockers: (
      source: string,
    ) => Effect.Effect<readonly string[], StorageError> = Effect.fn(
      'Migration.sourceBlockers',
    )(function* (source: string) {
      if (yield* isLink(source)) {
        return [`source contains a symbolic link: ${source}`];
      }
      if (!(yield* exists(source))) {
        return [];
      }
      const sourceInfo = yield* info(source);
      if (sourceInfo.type === 'File') {
        return [];
      }
      if (sourceInfo.type !== 'Directory') {
        return [`unsupported source entry: ${source}`];
      }
      const nested = yield* Effect.forEach(
        yield* entries(source),
        (entry) => sourceBlockers(path.join(source, entry)),
        { concurrency: 1 },
      );
      return nested.flat();
    });

    const copyConflicts: (
      source: string,
      destination: string,
    ) => Effect.Effect<readonly string[], StorageError> = Effect.fn(
      'Migration.copyConflicts',
    )(function* (source: string, destination: string) {
      if (yield* isLink(source)) {
        return [`migration source is a symbolic link: ${source}`];
      }
      if (yield* isLink(destination)) {
        return [`migration destination is a symbolic link: ${destination}`];
      }
      if (!(yield* exists(source))) {
        return [];
      }
      const sourceInfo = yield* info(source);
      const targetExists = yield* exists(destination);
      if (targetExists && sourceInfo.type !== (yield* info(destination)).type) {
        return [`migration type conflict: ${source} -> ${destination}`];
      }
      if (sourceInfo.type === 'Directory') {
        const nested = yield* Effect.forEach(
          yield* entries(source),
          (entry) =>
            copyConflicts(
              path.join(source, entry),
              path.join(destination, entry),
            ),
          { concurrency: 1 },
        );
        return nested.flat();
      }
      if (sourceInfo.type !== 'File') {
        return [`unsupported migration entry: ${source}`];
      }
      if (!targetExists) {
        return [];
      }
      const left = yield* read(source);
      const right = yield* read(destination);
      return left.length === right.length &&
        left.every((byte, index) => byte === right[index])
        ? []
        : [`migration content conflict: ${source} -> ${destination}`];
    });

    const mergeMissing: (
      source: string,
      destination: string,
    ) => Effect.Effect<void, StorageError> = Effect.fn(
      'Migration.mergeMissing',
    )(function* (source: string, destination: string) {
      if (!(yield* exists(source))) {
        return;
      }
      const sourceInfo = yield* info(source);
      if (sourceInfo.type === 'Directory') {
        yield* fileSystem
          .makeDirectory(destination, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError(storageFailure('makeDirectory', destination)));
        yield* Effect.forEach(
          yield* entries(source),
          (entry) =>
            mergeMissing(
              path.join(source, entry),
              path.join(destination, entry),
            ),
          { concurrency: 1, discard: true },
        );
        return;
      }
      if (yield* exists(destination)) {
        return;
      }
      yield* fileSystem
        .makeDirectory(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        })
        .pipe(
          Effect.mapError(
            storageFailure('makeDirectory', path.dirname(destination)),
          ),
        );
      yield* fileSystem
        .copy(source, destination, { overwrite: false })
        .pipe(
          Effect.mapError(
            storageFailure('copy', `${source} -> ${destination}`),
          ),
        );
    });

    const files = { isLink, sourceBlockers, copyConflicts, mergeMissing };

    const sourceLocation = Effect.fn('Migration.sourceLocation')(function* (
      sourceRepo: string,
    ) {
      const requested = path.resolve(sourceRepo);
      const resolved = (yield* storage.exists(requested))
        ? yield* fileSystem.realPath(requested).pipe(
            Effect.mapError(() =>
              StorageError.make({
                operation: 'realPath',
                path: requested,
              }),
            ),
          )
        : requested;
      const blockers: string[] = [];
      if (yield* files.isLink(requested)) {
        blockers.push('source root is a symbolic link');
      }
      if (
        resolved === path.parse(resolved).root ||
        resolved === path.resolve(paths.userHome) ||
        resolved === path.resolve(paths.home) ||
        resolved === path.resolve(paths.agentmailHome)
      ) {
        blockers.push('source is a protected user or runtime directory');
      }
      for (const protectedPath of [
        paths.userHome,
        paths.home,
        paths.agentmailHome,
        paths.claudeHome,
        paths.codexHome,
        paths.agentsHome,
        paths.openClawHome,
      ]) {
        const canonical = (yield* storage.exists(protectedPath))
          ? yield* fileSystem.realPath(protectedPath).pipe(
              Effect.mapError(() =>
                StorageError.make({
                  operation: 'realPath',
                  path: protectedPath,
                }),
              ),
            )
          : path.resolve(protectedPath);
        if (
          canonical === resolved ||
          canonical.startsWith(`${resolved}${path.sep}`)
        ) {
          blockers.push(
            'source contains a protected user or runtime directory',
          );
        }
      }
      return { resolved, blockers };
    });

    const identityBlockers = Effect.fn('Migration.identityBlockers')(function* (
      resolved: string,
    ) {
      const blockers: string[] = [];
      const identityContent = yield* storage.readText(
        path.join(resolved, 'AGENTS.md'),
      );
      if (identityContent === undefined) {
        blockers.push('legacy identity is missing: AGENTS.md');
      } else if (parseLegacyIdentity(identityContent) === undefined) {
        blockers.push('legacy identity block could not be decoded');
      }
      const currentIdentity = yield* storage.readJson(paths.identityData);
      if (currentIdentity !== undefined && identityContent !== undefined) {
        const decoded =
          Schema.decodeUnknownOption(AgentIdentity)(currentIdentity);
        const legacy = parseLegacyIdentity(identityContent);
        if (
          Option.isNone(decoded) ||
          legacy === undefined ||
          !Schema.toEquivalence(AgentIdentity)(decoded.value, legacy)
        ) {
          blockers.push('current identity conflicts with the legacy identity');
        }
      }
      return blockers;
    });

    const plan = Effect.fn('Migration.plan')(function* (sourceRepo: string) {
      const { resolved, blockers } = yield* sourceLocation(sourceRepo);
      const packageInput = yield* storage.readJson(
        path.join(resolved, 'package.json'),
      );
      const productSource = asRecord(packageInput).name === 'social-harness';
      if (productSource) {
        blockers.push('source is the Social Harness product repository');
      }
      const sourceExists = yield* storage.exists(resolved);
      if (!sourceExists) {
        blockers.push(`source does not exist: ${resolved}`);
      }
      if (sourceExists && blockers.length === 0) {
        blockers.push(...(yield* files.sourceBlockers(resolved)));
      }

      const names = sourceExists
        ? yield* fileSystem.readDirectory(resolved).pipe(
            Effect.mapError(() =>
              StorageError.make({
                operation: 'readDirectory',
                path: resolved,
              }),
            ),
          )
        : [];
      const unrelated = names.filter((name) => !isOwnedLegacyEntry(name));
      if (unrelated.length > 0) {
        const sortedUnrelated = unrelated.toSorted((left, right) =>
          left.localeCompare(right),
        );
        blockers.push(`unrelated files: ${sortedUnrelated.join(', ')}`);
      }

      blockers.push(...(yield* identityBlockers(resolved)));
      for (const [source, destination] of [
        [path.join(resolved, 'roster.md'), paths.roster],
        [path.join(resolved, 'status.md'), paths.status],
        [path.join(resolved, '.agents', 'behaviors'), paths.norms],
      ] as const) {
        blockers.push(...(yield* files.copyConflicts(source, destination)));
      }

      if (names.includes('.git')) {
        const gitStatus = yield* processSpawner
          .string(
            ChildProcess.make('git', ['status', '--porcelain'], {
              cwd: resolved,
            }),
            { includeStderr: true },
          )
          .pipe(Effect.catch(() => Effect.succeed('git status failed')));
        if (gitStatus.trim().length > 0) {
          blockers.push('source repository has uncommitted or untracked data');
        }
      }

      const artifact = (
        kind: (typeof LegacyArtifact.Type)['kind'],
        relativePath: string,
        action: (typeof LegacyArtifact.Type)['action'],
        reason: string,
      ) =>
        LegacyArtifact.make({
          kind,
          path: path.join(resolved, relativePath),
          action,
          reason,
        });
      const currentRosterExists = yield* storage.exists(paths.roster);
      const currentStatusExists = yield* storage.exists(paths.status);
      const artifacts = [
        artifact('identity', 'AGENTS.md', 'migrate', 'canonical identity'),
        artifact(
          'identity',
          'CLAUDE.md',
          'remove',
          'legacy host identity duplicate',
        ),
        canonicalFileArtifact(
          'roster',
          path.join(resolved, 'roster.md'),
          currentRosterExists,
          'canonical roster',
        ),
        canonicalFileArtifact(
          'status',
          path.join(resolved, 'status.md'),
          currentStatusExists,
          'current owner status',
        ),
        artifact(
          'norm',
          '.agents/behaviors',
          'migrate',
          'recursively merge missing team behavior files after conflict checks',
        ),
        artifact(
          'norm',
          'proposals',
          'remove',
          'draft behavior examples incorporated into product documentation',
        ),
        artifact(
          'state',
          'team',
          'remove',
          'legacy product-planning working set incorporated into product documentation',
        ),
        artifact('hook', '.claude/skills', 'remove', 'legacy repo skills'),
        artifact('mcp', '.mcp.json', 'remove', 'legacy repo MCP wiring'),
        artifact('poller', 'bin/agent-cron', 'remove', 'Claude-only poller'),
        artifact('state', '.agent-kit', 'remove', 'legacy repo marker'),
        artifact(
          'clone',
          '.',
          productSource || blockers.length > 0 ? 'blocked' : 'remove',
          productSource
            ? 'product source is never deleted'
            : 'dedicated clean legacy clone',
        ),
      ];
      return MigrationPlan.make({
        schemaVersion: 1,
        sourceRepo: resolved,
        productSource,
        clean: blockers.length === 0,
        artifacts,
        blockers,
      });
    });

    const preserveCurrentDocuments = Effect.fn(
      'Migration.preserveCurrentDocuments',
    )(function* (identity: AgentIdentity) {
      if (!(yield* storage.exists(paths.identity))) {
        yield* storage.writeText(
          paths.identity,
          yield* templates.agentIdentity(identity),
        );
      }
      if (!(yield* storage.exists(paths.identityData))) {
        yield* storage.writeJson(paths.identityData, identity);
      }
      if (!(yield* storage.exists(paths.protocol))) {
        yield* storage.writeText(
          paths.protocol,
          yield* templates.collaborationProtocol(),
        );
      }
    });

    const apply = Effect.fn('Migration.apply')(function* (
      sourceRepo: string,
      deleteSource: boolean,
    ) {
      const migration = yield* plan(sourceRepo);
      const reasons = [
        ...migration.blockers,
        ...(deleteSource ? [] : ['clean migration requires --delete-source']),
      ];
      if (reasons.length > 0) {
        return yield* Effect.fail(MigrationBlockedError.make({ reasons }));
      }

      const legacyIdentityContent = yield* storage.readText(
        path.join(migration.sourceRepo, 'AGENTS.md'),
      );
      const identity =
        legacyIdentityContent === undefined
          ? undefined
          : parseLegacyIdentity(legacyIdentityContent);
      if (identity === undefined) {
        return yield* Effect.fail(
          MigrationBlockedError.make({
            reasons: ['legacy identity block could not be decoded'],
          }),
        );
      }
      yield* preserveCurrentDocuments(identity);
      yield* files.mergeMissing(
        path.join(migration.sourceRepo, 'roster.md'),
        paths.roster,
      );
      yield* files.mergeMissing(
        path.join(migration.sourceRepo, 'status.md'),
        paths.status,
      );
      yield* files.mergeMissing(
        path.join(migration.sourceRepo, '.agents', 'behaviors'),
        paths.norms,
      );

      if (!(yield* storage.exists(paths.config))) {
        yield* configuration.save(makeDefaultConfig());
      }
      yield* storage.ensureDirectory(paths.runtime);
      yield* storage.ensureDirectory(paths.logs);
      yield* scheduler.install();
      yield* adapters.installDetected();
      const adapterVerification = yield* adapters.detect();
      const missingAdapters = adapterVerification.filter(
        (adapter) => adapter.compatible && !adapter.installed,
      );
      if (missingAdapters.length > 0) {
        return yield* Effect.fail(
          MigrationBlockedError.make({
            reasons: [
              `adapter verification failed: ${missingAdapters
                .map((adapter) => adapter.name)
                .join(', ')}`,
            ],
          }),
        );
      }
      yield* mailbox.verifyConnection();
      yield* mailbox.rewriteLabels(rewriteLegacyLabels);

      const verification = yield* plan(migration.sourceRepo);
      if (!verification.clean) {
        return yield* Effect.fail(
          MigrationBlockedError.make({ reasons: verification.blockers }),
        );
      }

      const claudeSettings = path.join(paths.claudeHome, 'settings.json');
      const settings = yield* storage.readJson(claudeSettings);
      if (settings !== undefined) {
        yield* storage.writeJson(
          claudeSettings,
          removeLegacyHooks(settings, migration.sourceRepo),
        );
      }

      const inbox = (yield* storage.readText(paths.agentmailInbox))?.trim();
      const legacyName = inbox?.split('@')[0];
      if (legacyName !== undefined && /^[A-Za-z0-9._-]+$/.test(legacyName)) {
        const legacyPlist = path.join(
          paths.userHome,
          'Library',
          'LaunchAgents',
          `to.agentmail.${legacyName}.inbox.plist`,
        );
        const uid = (yield* processSpawner
          .string(ChildProcess.make('id', ['-u']))
          .pipe(Effect.catch(() => Effect.succeed('')))).trim();
        if (/^\d+$/.test(uid)) {
          yield* processSpawner
            .exitCode(
              ChildProcess.make('launchctl', [
                'bootout',
                `gui/${uid}`,
                legacyPlist,
              ]),
            )
            .pipe(Effect.ignore);
        }
        yield* storage.remove(legacyPlist);
        yield* storage.remove(
          path.join(paths.agentmailHome, `${legacyName}.app`),
        );
      }
      for (const name of [
        'cron-state.json',
        'brief-state.json',
        'cron.lock',
        'cron.log',
        'cron.err',
      ]) {
        yield* storage.remove(path.join(paths.agentmailHome, name));
      }

      const claudeAvailable = yield* processSpawner
        .exitCode(ChildProcess.make('which', ['claude']))
        .pipe(
          Effect.map((exitCode) => Number(exitCode) === 0),
          Effect.catch(() => Effect.succeed(false)),
        );
      if (claudeAvailable) {
        yield* processSpawner
          .exitCode(
            ChildProcess.make('claude', [
              'mcp',
              'remove',
              '--scope',
              'user',
              'agentmail',
            ]),
          )
          .pipe(Effect.ignore);
      }
      yield* storage.writeJson(paths.migration, migration);
      yield* storage.remove(migration.sourceRepo);
      return migration;
    });

    return { plan, apply };
  }).pipe(Effect.withSpan('migrationLayer')),
);
