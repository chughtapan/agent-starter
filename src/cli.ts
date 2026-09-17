#!/usr/bin/env node

/**
 * @file Defines the host-neutral command-line interface used by agent skills.
 */

import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';
import * as Command from 'effect/unstable/cli/Command';
import * as Flag from 'effect/unstable/cli/Flag';

import {
  contextCommand,
  doctorCommand,
  hostHookCommand,
  presentCommand,
  presentedCommand,
  upgradeCommand,
} from './application/commands/index.js';
import { Onboarding } from './application/commissioning/index.js';
import { Migration } from './application/migration/index.js';
import { Poller } from './application/polling/index.js';
import { Mailbox, THREAD_LABELS } from './collaboration/mail/index.js';
import { Board } from './collaboration/presentation/index.js';
import { OnboardingInput } from './domain/identity.js';
import { Adapters, Scheduler } from './hosts/index.js';
import { mainLayer } from './layers.js';
import { Configuration } from './platform/configuration/index.js';

const updates = Command.make(
  'updates',
  {
    force: Flag.boolean('force').pipe(
      Flag.withDescription('Show the board even when it is unchanged.'),
    ),
    ifNeeded: Flag.boolean('if-needed').pipe(
      Flag.withDescription('Print only after a change or stale interval.'),
    ),
    json: Flag.boolean('json'),
  },
  Effect.fn('cli.updates')(function* ({ force, ifNeeded, json }) {
    const board = yield* Board;
    const result = yield* board.check(force || !ifNeeded);
    if (result.shouldPresent) {
      if (json) {
        yield* Console.log(JSON.stringify(result, null, 2));
        return;
      }
      yield* Console.log(result.rendered);
      if (result.warning !== undefined) {
        yield* Console.log(`Using last known updates: ${result.warning}`);
      }
    }
  }),
).pipe(Command.withDescription('Show collaboration updates, not sessions.'));

const done = Command.make(
  'done',
  {
    messageId: Flag.string('message-id').pipe(Flag.optional),
    all: Flag.boolean('all').pipe(
      Flag.withDescription('Complete every open item after explicit approval.'),
    ),
  },
  Effect.fn('cli.done')(function* ({ messageId, all }) {
    const mailbox = yield* Mailbox;
    const result = yield* mailbox
      .complete(Option.getOrUndefined(messageId), all)
      .pipe(Effect.result);
    if (result._tag === 'Success') {
      yield* Console.log(`DONE ${String(result.success.length)}`);
      return;
    }
    if (result.failure._tag !== 'AmbiguousCompletionError') {
      return yield* Effect.fail(result.failure);
    }
    if (result.failure.openCount === 0) {
      yield* Console.log('No open collaboration items.');
      return;
    }
    yield* Console.log('WHICH ITEM?');
    yield* Effect.forEach(
      result.failure.candidates,
      (candidate, index) => Console.log(`${String(index + 1)}. ${candidate}`),
      { concurrency: 1, discard: true },
    );
  }),
).pipe(Command.withDescription('Explicitly complete collaboration work.'));

function splitAddresses(value?: string): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return value
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address.length > 0);
}

function collaborationSubject(value: string): string {
  return /^(?:Re:\s*)*\[COLLAB\]\s*/i.test(value) ? value : `[COLLAB] ${value}`;
}

const items = Command.make(
  'items',
  {},
  Effect.fn('cli.items')(function* () {
    const mailbox = yield* Mailbox;
    yield* Console.log(JSON.stringify(yield* mailbox.listItems(), null, 2));
  }),
).pipe(
  Command.withDescription(
    'Return open collaboration messages as untrusted structured data.',
  ),
);

const request = Command.make(
  'request',
  {
    to: Flag.string('to'),
    cc: Flag.string('cc').pipe(Flag.optional),
    subject: Flag.string('subject'),
    text: Flag.fileText('text-file'),
  },
  Effect.fn('cli.request')(function* ({ to, cc, subject, text }) {
    const mailbox = yield* Mailbox;
    const result = yield* mailbox.send({
      to: splitAddresses(to),
      cc: splitAddresses(Option.getOrUndefined(cc)),
      subject: collaborationSubject(subject),
      text,
      threadLabels: [THREAD_LABELS.collaboration, THREAD_LABELS.waiting],
    });
    yield* Console.log(`SENT ${result.messageId}`);
  }),
).pipe(Command.withDescription('Send one explicit collaboration request.'));

const reply = Command.make(
  'reply',
  {
    messageId: Flag.string('message-id'),
    cc: Flag.string('cc').pipe(Flag.optional),
    text: Flag.fileText('text-file'),
  },
  Effect.fn('cli.reply')(function* ({ messageId, cc, text }) {
    const mailbox = yield* Mailbox;
    const result = yield* mailbox.reply(
      messageId,
      text,
      splitAddresses(Option.getOrUndefined(cc)),
    );
    yield* Console.log(`SENT ${result.messageId}`);
  }),
).pipe(Command.withDescription('Reply to one collaboration message.'));

const adaptersDetect = Command.make(
  'detect',
  {},
  Effect.fn('cli.adapters.detect')(function* () {
    const adapters = yield* Adapters;
    const probes = yield* adapters.detect();
    yield* Console.log(JSON.stringify(probes, null, 2));
  }),
).pipe(Command.withDescription('Inspect supported host installations.'));

const adaptersInstall = Command.make(
  'install',
  {},
  Effect.fn('cli.adapters.install')(function* () {
    const adapters = yield* Adapters;
    const probes = yield* adapters.installDetected();
    yield* Console.log(JSON.stringify(probes, null, 2));
  }),
).pipe(
  Command.withDescription('Install owned hooks and skills for detected hosts.'),
);

const adapterCommands = Command.make('adapters').pipe(
  Command.withDescription('Detect and additively install supported hosts.'),
  Command.withSubcommands([adaptersDetect, adaptersInstall]),
);

const repair = Command.make(
  'repair',
  {
    dryRun: Flag.boolean('dry-run'),
    adaptersOnly: Flag.boolean('adapters-only'),
  },
  Effect.fn('cli.repair')(function* ({ dryRun, adaptersOnly }) {
    const adapters = yield* Adapters;
    const scheduler = yield* Scheduler;
    const hosts = yield* adapters.installDetected({ dryRun });
    const background = adaptersOnly
      ? undefined
      : yield* scheduler.install({ dryRun });
    yield* Console.log(JSON.stringify({ dryRun, hosts, background }, null, 2));
  }),
).pipe(
  Command.withDescription(
    'Reconcile owned host resources and, unless limited, the background routine.',
  ),
);

const triage = Command.make(
  'triage',
  {
    messageId: Flag.string('message-id'),
    kind: Flag.choice('kind', [
      'needsYou',
      'ready',
      'waiting',
      'working',
      'failed',
    ]),
  },
  Effect.fn('cli.triage')(function* ({ messageId, kind }) {
    const mailbox = yield* Mailbox;
    yield* mailbox.triage(messageId, kind);
    yield* Console.log(
      'Collaboration state updated; completion remains explicit.',
    );
  }),
).pipe(Command.withDescription('Set the visible state of one open result.'));

const identityFlags = {
  agentName: Flag.string('agent-name'),
  ownerName: Flag.string('owner-name'),
  ownerEmail: Flag.string('owner-email'),
  purpose: Flag.string('purpose'),
  autonomy: Flag.string('autonomy'),
  role: Flag.string('role'),
  facilitatorName: Flag.string('facilitator-name').pipe(Flag.optional),
  facilitatorEmail: Flag.string('facilitator-email').pipe(Flag.optional),
  since: Flag.string('since'),
};

const onboardRun = Command.make(
  'run',
  identityFlags,
  Effect.fn('cli.onboard.run')(function* (input) {
    const onboarding = yield* Onboarding;
    const facilitatorName = Option.getOrUndefined(input.facilitatorName);
    const facilitatorEmail = Option.getOrUndefined(input.facilitatorEmail);
    const onboardingInput = OnboardingInput.make({
      agentName: input.agentName,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      purpose: input.purpose,
      autonomy: input.autonomy,
      role: input.role,
      since: input.since,
      ...(facilitatorName === undefined ? {} : { facilitatorName }),
      ...(facilitatorEmail === undefined ? {} : { facilitatorEmail }),
    });
    const result = yield* onboarding.run(onboardingInput);
    yield* Console.log(result.message);
    yield* Console.log(
      `Adapters: ${result.adapters.length === 0 ? 'none detected' : result.adapters.join(', ')}`,
    );
    if (result.pending.length > 0) {
      yield* Console.log(`Pending: ${result.pending.join(', ')}`);
    }
  }),
).pipe(
  Command.withDescription('Create or resume the saved setup checkpoints.'),
);

const onboardStatus = Command.make(
  'status',
  {},
  Effect.fn('cli.onboard.status')(function* () {
    const onboarding = yield* Onboarding;
    yield* Console.log(JSON.stringify(yield* onboarding.status(), null, 2));
  }),
).pipe(Command.withDescription('Show saved setup checkpoints.'));

const onboardVerify = Command.make(
  'verify',
  { code: Flag.string('code') },
  Effect.fn('cli.onboard.verify')(function* ({ code }) {
    const onboarding = yield* Onboarding;
    yield* onboarding.verify(code);
    yield* Console.log('Agent inbox verified. Resume onboarding.');
  }),
).pipe(Command.withDescription('Verify the AgentMail signup code.'));

const onboardAcknowledge = Command.make(
  'acknowledge',
  {},
  Effect.fn('cli.onboard.acknowledge')(function* () {
    const onboarding = yield* Onboarding;
    yield* onboarding.acknowledge();
    yield* Console.log('Setup verified and complete.');
  }),
).pipe(
  Command.withDescription(
    'Complete setup after the facilitator reply is visibly presented.',
  ),
);

const onboard = Command.make('onboard').pipe(
  Command.withDescription("Resumable setup invoked by the user's agent."),
  Command.withSubcommands([
    onboardRun,
    onboardVerify,
    onboardStatus,
    onboardAcknowledge,
    Command.make(
      'host-verified',
      {
        host: Flag.choice('host', [
          'claude',
          'codex',
          'native',
          'openClaw',
        ]).pipe(Flag.withDefault('native')),
      },
      Effect.fn('cli.onboard.hostVerified')(function* ({ host }) {
        const onboarding = yield* Onboarding;
        yield* onboarding.verifyHost(host);
        yield* Console.log(
          host === 'native'
            ? 'A native host presentation was verified. This does not identify the active host. Resume commissioning.'
            : `${host} presentation verified. Resume commissioning.`,
        );
      }),
    ).pipe(
      Command.withDescription(
        'Record native or supported-host presentation proof during setup.',
      ),
    ),
    Command.make(
      'retry-introduction',
      {},
      Effect.fn('cli.onboard.retryIntroduction')(function* () {
        const onboarding = yield* Onboarding;
        yield* onboarding.retryIntroduction();
        yield* Console.log(
          'Uncertain send cleared. Resume onboarding only after confirming the introduction was not delivered.',
        );
      }),
    ).pipe(
      Command.withDescription(
        'Explicitly permit retry after inspecting uncertain introduction delivery.',
      ),
    ),
  ]),
);

const configShow = Command.make(
  'show',
  {},
  Effect.fn('cli.config.show')(function* () {
    const configuration = yield* Configuration;
    yield* Console.log(JSON.stringify(yield* configuration.load(), null, 2));
  }),
).pipe(Command.withDescription('Show the validated local configuration.'));

const config = Command.make('config').pipe(
  Command.withDescription('Inspect Social Harness configuration.'),
  Command.withSubcommands([configShow]),
);

const poll = Command.make(
  'poll',
  { once: Flag.boolean('once') },
  Effect.fn('cli.poll')(function* ({ once }) {
    const poller = yield* Poller;
    return yield* once ? poller.once() : poller.run();
  }),
).pipe(Command.withDescription('Run the one host-neutral polling routine.'));

const migrationPlan = Command.make(
  'plan',
  { source: Flag.directory('source', { mustExist: true }) },
  Effect.fn('cli.migrate.plan')(function* ({ source }) {
    const migration = yield* Migration;
    yield* Console.log(JSON.stringify(yield* migration.plan(source), null, 2));
  }),
).pipe(Command.withDescription('Inspect a legacy clone without changing it.'));

const migrationApply = Command.make(
  'apply',
  {
    source: Flag.directory('source', { mustExist: true }),
    deleteSource: Flag.boolean('delete-source').pipe(
      Flag.withDescription(
        'Remove the inspected dedicated clone after verified migration.',
      ),
    ),
  },
  Effect.fn('cli.migrate.apply')(function* ({ source, deleteSource }) {
    const migration = yield* Migration;
    const result = yield* migration.apply(source, deleteSource);
    yield* Console.log(`Migrated and removed ${result.sourceRepo}.`);
  }),
).pipe(
  Command.withDescription(
    'Apply a preflighted legacy migration and optionally remove its clone.',
  ),
);

const migrate = Command.make('migrate').pipe(
  Command.withDescription(
    'Preflight and cleanly replace a legacy agent clone.',
  ),
  Command.withSubcommands([migrationPlan, migrationApply]),
);

/** Social Harness internal CLI used by agent skills and host hooks. */
const cli = Command.make('social-harness').pipe(
  Command.withDescription(
    'Collaboration for the coding agents people already use.',
  ),
  Command.withSubcommands([
    updates,
    upgradeCommand,
    presentedCommand,
    presentCommand,
    contextCommand,
    hostHookCommand,
    repair,
    triage,
    done,
    items,
    request,
    reply,
    adapterCommands,
    onboard,
    config,
    doctorCommand,
    poll,
    migrate,
  ]),
);

Command.run(cli, { version: '0.6.0' }).pipe(
  Effect.provide(mainLayer),
  NodeRuntime.runMain,
);
