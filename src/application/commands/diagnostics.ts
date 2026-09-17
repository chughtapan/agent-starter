/**
 * @file Reports independent setup checks without hiding partial failures.
 */

import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import * as Command from 'effect/unstable/cli/Command';
import * as Flag from 'effect/unstable/cli/Flag';

import { Mailbox, MailboxError } from '../../collaboration/mail/index.js';
import { MailboxCache } from '../../domain/collaboration.js';
import { Adapters, Scheduler } from '../../hosts/index.js';
import { Configuration } from '../../platform/configuration/index.js';
import { Paths, Storage } from '../../platform/persistence/index.js';
import { Upgrades } from '../../upgrades/index.js';

/** Reports all available evidence even when one subsystem is unavailable. */
export const doctorCommand = Command.make(
  'doctor',
  { json: Flag.boolean('json') },
  Effect.fn('cli.doctor')(function* ({ json }) {
    const configuration = yield* Configuration;
    const mailbox = yield* Mailbox;
    const adapters = yield* Adapters;
    const scheduler = yield* Scheduler;
    const upgrades = yield* Upgrades;
    const storage = yield* Storage;
    const paths = yield* Paths;
    const checks = yield* Effect.all(
      {
        config: configuration.load().pipe(Effect.result),
        mail: mailbox.verifyConnection().pipe(
          Effect.timeoutOrElse({
            duration: '5 seconds',
            orElse: () =>
              Effect.fail(
                MailboxError.make({
                  operation: 'doctor',
                  reason: 'mail check timed out',
                }),
              ),
          }),
          Effect.result,
        ),
        hosts: adapters.detect().pipe(Effect.result),
        background: scheduler.status().pipe(Effect.result),
        software: upgrades.status().pipe(Effect.result),
        cache: storage
          .readJson(paths.cache)
          .pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(MailboxCache)),
            Effect.result,
          ),
      },
      { concurrency: 4 },
    );
    const report = {
      config:
        checks.config._tag === 'Success'
          ? { ok: true, detail: 'configuration valid' }
          : { ok: false, detail: 'configuration invalid; inspect config.json' },
      mail:
        checks.mail._tag === 'Success'
          ? { ok: true, detail: checks.mail.success }
          : {
              ok: false,
              detail:
                'mail unavailable; check connectivity and private credentials',
            },
      hosts:
        checks.hosts._tag === 'Success'
          ? {
              ok: hostsReady(checks.hosts.success),
              detail: checks.hosts.success,
            }
          : {
              ok: false,
              detail:
                'host inspection failed; inspect native configuration before repair',
            },
      background:
        checks.background._tag === 'Success'
          ? {
              ok: checks.background.success.installed,
              detail: checks.background.success.detail,
            }
          : {
              ok: false,
              detail: 'background check failed; inspect launchd before repair',
            },
      software:
        checks.software._tag === 'Success'
          ? { ok: true, detail: checks.software.success }
          : {
              ok: false,
              detail:
                'software-update state invalid; inspect the installation before repair',
            },
      lastSuccessfulSync:
        checks.cache._tag === 'Success' ? checks.cache.success.lastSync : null,
    };
    if (json) {
      yield* Console.log(JSON.stringify(report, null, 2));
    } else {
      yield* Console.log('COLLABORATION SETUP');
      for (const [name, check] of [
        ['CONFIG', report.config],
        ['MAIL', report.mail],
        ['BACKGROUND', report.background],
        ['HOSTS', report.hosts],
        ['SOFTWARE', report.software],
      ] as const) {
        yield* Console.log(renderCheck(name, check));
      }
      yield* Console.log(
        `LAST SYNC ${report.lastSuccessfulSync ?? 'not yet verified'}`,
      );
    }
    if (
      ![
        report.config,
        report.mail,
        report.hosts,
        report.background,
        report.software,
      ].every((check) => check.ok)
    ) {
      return yield* Effect.fail(
        MailboxError.make({
          operation: 'doctor',
          reason:
            'one or more setup checks need attention; see the report above',
        }),
      );
    }
  }),
).pipe(
  Command.withDescription(
    'Report configuration, mail, host, background, and software-update health.',
  ),
);

function hostsReady(
  probes: ReadonlyArray<{
    readonly compatible: boolean;
    readonly installed: boolean;
  }>,
): boolean {
  const compatible = probes.filter((probe) => probe.compatible);
  return compatible.length > 0 && compatible.every((probe) => probe.installed);
}

function renderCheck(
  name: string,
  check: { readonly ok: boolean; readonly detail: unknown },
): string {
  const detail =
    typeof check.detail === 'string'
      ? check.detail
      : JSON.stringify(check.detail);
  return `${name} ${check.ok ? 'OK' : 'NEEDS ATTENTION'} ${detail}`;
}
