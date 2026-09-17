#!/usr/bin/env node

/**
 * @file Provides the explicit, opt-in command boundary for live host evaluations.
 */

import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Command from 'effect/unstable/cli/Command';
import * as Flag from 'effect/unstable/cli/Flag';

import { EvaluationError } from './domain/index.js';
import { hostProcessesLayer } from './hosts/index.js';
import { evaluate } from './index.js';

const command = Command.make(
  'social-harness-evals',
  {
    root: Flag.string('root').pipe(
      Flag.withDescription(
        'Absolute disposable directory named social-harness-eval-<safe-id>.',
      ),
    ),
    fixture: Flag.string('fixture').pipe(
      Flag.withDefault('evals/fixtures/pair.example.json'),
    ),
    runtime: Flag.string('runtime').pipe(Flag.withDefault('dist/cli.js')),
    prepare: Flag.boolean('prepare').pipe(
      Flag.withDescription(
        'Install the candidate into isolated profiles; no signup or mail.',
      ),
    ),
    execute: Flag.boolean('execute').pipe(
      Flag.withDescription('Run the declared scenario after preflight.'),
    ),
    reuseNativeAuth: Flag.boolean('reuse-native-auth').pipe(
      Flag.withDescription(
        'Reuse existing Claude credentials and seed only Codex auth.json into its private eval profile.',
      ),
    ),
    trustOwnedHooks: Flag.boolean('trust-owned-hooks').pipe(
      Flag.withDescription(
        'Use Codex native trust storage for exact owned candidate hooks in the isolated profile.',
      ),
    ),
    scenario: Flag.choice('scenario', [
      'skill-discovery',
      'generic-negative',
      'roundtrip',
    ]).pipe(Flag.withDefault('skill-discovery')),
    repeats: Flag.integer('repeats').pipe(Flag.withDefault(3)),
    timeoutSeconds: Flag.integer('timeout-seconds').pipe(Flag.withDefault(180)),
  },
  Effect.fn('evals.cli')(function* (options) {
    if (
      options.repeats < 1 ||
      options.repeats > 10 ||
      options.timeoutSeconds < 10 ||
      options.timeoutSeconds > 600
    ) {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'arguments',
          reason: 'Repeats must be 1–10 and timeout seconds 10–600.',
        }),
      );
    }
    const status = yield* evaluate(options);
    if (status === 'blocked' || status === 'fail') {
      return yield* Effect.fail(
        EvaluationError.make({
          operation: 'scenario',
          reason: `Evaluation ${status}; inspect the retained evidence.`,
        }),
      );
    }
  }),
).pipe(
  Command.withDescription(
    'Real Claude + Codex evidence; preflight by default, explicit login reuse and native trust for exact owned hooks.',
  ),
);

const platform = Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici);
const services = hostProcessesLayer.pipe(Layer.provideMerge(platform));

Command.run(command, { version: '1.0.0' }).pipe(
  Effect.provide(services),
  Effect.catch((error) =>
    Effect.fail(
      EvaluationError.make({
        operation:
          error._tag === 'EvaluationError' ? error.operation : 'boundary',
        reason:
          error._tag === 'EvaluationError'
            ? error.reason
            : 'Evaluation stopped at a validated boundary; no raw provider or credential data is printed.',
      }),
    ),
  ),
  NodeRuntime.runMain,
);
