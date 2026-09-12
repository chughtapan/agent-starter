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

import { Adapters } from './adapters.js';
import { Board } from './board.js';
import { Configuration } from './config.js';
import { OnboardingInput } from './domain/identity.js';
import { mainLayer } from './layers.js';
import { Mailbox, THREAD_LABELS } from './mailbox.js';
import { Migration } from './migration.js';
import { Onboarding } from './onboarding.js';
import { Poller } from './poller.js';
import { Scheduler } from './scheduler.js';

const updates = Command.make(
  'updates',
  {
    force: Flag.boolean('force').pipe(
      Flag.withDescription('Show the board even when it is unchanged.'),
    ),
    ifNeeded: Flag.boolean('if-needed').pipe(
      Flag.withDescription('Print only after a change or stale interval.'),
    ),
  },
  Effect.fn('cli.updates')(function* ({ force, ifNeeded }) {
    const board = yield* Board;
    const result = yield* board.check(force || !ifNeeded);
    if (result.shouldPresent) {
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
);

const adaptersInstall = Command.make(
  'install',
  {},
  Effect.fn('cli.adapters.install')(function* () {
    const adapters = yield* Adapters;
    const probes = yield* adapters.installDetected();
    yield* Console.log(JSON.stringify(probes, null, 2));
  }),
);

const adapterCommands = Command.make('adapters').pipe(
  Command.withDescription('Detect and additively install supported hosts.'),
  Command.withSubcommands([adaptersDetect, adaptersInstall]),
);

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
);

const onboardStatus = Command.make(
  'status',
  {},
  Effect.fn('cli.onboard.status')(function* () {
    const onboarding = yield* Onboarding;
    yield* Console.log(JSON.stringify(yield* onboarding.status(), null, 2));
  }),
);

const onboardVerify = Command.make(
  'verify',
  { code: Flag.string('code') },
  Effect.fn('cli.onboard.verify')(function* ({ code }) {
    const onboarding = yield* Onboarding;
    yield* onboarding.verify(code);
    yield* Console.log('Agent inbox verified. Resume onboarding.');
  }),
);

const onboardAcknowledge = Command.make(
  'acknowledge',
  {},
  Effect.fn('cli.onboard.acknowledge')(function* () {
    const onboarding = yield* Onboarding;
    yield* onboarding.acknowledge();
    yield* Console.log('Setup verified and complete.');
  }),
);

const onboard = Command.make('onboard').pipe(
  Command.withDescription("Resumable setup invoked by the user's agent."),
  Command.withSubcommands([
    onboardRun,
    onboardVerify,
    onboardStatus,
    onboardAcknowledge,
  ]),
);

const configShow = Command.make(
  'show',
  {},
  Effect.fn('cli.config.show')(function* () {
    const configuration = yield* Configuration;
    yield* Console.log(JSON.stringify(yield* configuration.load(), null, 2));
  }),
);

const config = Command.make('config').pipe(
  Command.withSubcommands([configShow]),
);

const doctor = Command.make(
  'doctor',
  {},
  Effect.fn('cli.doctor')(function* () {
    const adapters = yield* Adapters;
    const mailbox = yield* Mailbox;
    const configuration = yield* Configuration;
    const config = yield* configuration.load();
    const inbox = yield* mailbox.verifyConnection();
    const probes = yield* adapters.detect();
    const scheduler = yield* Scheduler;
    const schedulerStatus = yield* scheduler.status();
    yield* Console.log(`CONFIG schema ${String(config.schemaVersion)}: ok`);
    yield* Console.log(`MAIL ${inbox}: ok`);
    yield* Console.log(
      `BACKGROUND ${schedulerStatus.installed ? 'ready' : schedulerStatus.detail}`,
    );
    yield* Effect.forEach(
      probes,
      (probe) => {
        let status = 'not installed';
        if (!probe.detected) {
          status = 'not found';
        } else if (!probe.compatible) {
          status = 'disabled';
        } else if (probe.installed) {
          status = 'ready';
        }
        return Console.log(`${probe.name.toUpperCase()} ${status}`);
      },
      { concurrency: 1, discard: true },
    );
  }),
).pipe(
  Command.withDescription('Verify local setup and live AgentMail access.'),
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
);

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
);

const migrate = Command.make('migrate').pipe(
  Command.withDescription(
    'Preflight and cleanly replace a legacy agent clone.',
  ),
  Command.withSubcommands([migrationPlan, migrationApply]),
);

/** Social Harness internal CLI used by agent skills and host hooks. */
export const cli = Command.make('social-harness').pipe(
  Command.withDescription(
    'Collaboration for the coding agents people already use.',
  ),
  Command.withSubcommands([
    updates,
    done,
    items,
    request,
    reply,
    adapterCommands,
    onboard,
    config,
    doctor,
    poll,
    migrate,
  ]),
);

Command.run(cli, { version: '0.4.0' }).pipe(
  Effect.provide(mainLayer),
  NodeRuntime.runMain,
);
