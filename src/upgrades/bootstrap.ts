#!/usr/bin/env node

/**
 * @file Keeps installed hooks and launchd on one stable package entry point.
 */

import * as NodeRuntime from '@effect/platform-node-shared/NodeRuntime';
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import * as NodeServices from '@effect/platform-node/NodeServices';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';
import * as Stdio from 'effect/Stdio';
import * as ChildProcess from 'effect/unstable/process/ChildProcess';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { fileURLToPath } from 'node:url';

import { ActiveRelease, UpgradeError } from '../domain/upgrades.js';
import { configurationLayer } from '../platform/configuration/index.js';
import {
  Paths,
  pathsLayer,
  Storage,
  storageLayer,
} from '../platform/persistence/index.js';
import { Upgrades } from './ports.js';
import { releasePackagesLayer } from './releases.js';
import { upgradesLayer } from './service.js';

const platformLayer = Layer.mergeAll(
  NodeServices.layer,
  NodeHttpClient.layerUndici,
);
const persistenceLayer = Layer.mergeAll(pathsLayer, storageLayer).pipe(
  Layer.provideMerge(platformLayer),
);
const configuredLayer = configurationLayer.pipe(
  Layer.provideMerge(persistenceLayer),
);
const recoveryLayer = upgradesLayer.pipe(
  Layer.provideMerge(
    releasePackagesLayer.pipe(Layer.provideMerge(configuredLayer)),
  ),
);

const bootstrap = Effect.gen(function* () {
  const paths = yield* Paths;
  const path = yield* Path.Path;
  const storage = yield* Storage;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdio = yield* Stdio.Stdio;
  const cliArguments = yield* stdio.args;
  const stableEntry = fileURLToPath(import.meta.url);
  const baselineCli = fileURLToPath(new URL('../cli.js', import.meta.url));
  const upgrades = yield* Upgrades;
  const recovered = yield* upgrades.recover();
  if (recovered !== undefined) {
    yield* Console.warn(
      `Interrupted software update restored Social Harness ${recovered.currentVersion}.`,
    );
  }
  const input = yield* storage.readJson(
    path.join(paths.runtime, 'active-release.json'),
  );
  const active =
    input === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(ActiveRelease)(input);
  const selectedCli =
    active === undefined || active.current === active.baseline
      ? baselineCli
      : path.join(
          paths.runtime,
          'versions',
          active.current,
          'node_modules',
          'social-harness',
          'dist',
          'cli.js',
        );
  let cli = selectedCli;
  if (cli !== baselineCli) {
    const startup = yield* spawner
      .exitCode(
        ChildProcess.make(process.execPath, [cli, '--version'], {
          stdin: 'ignore',
          stdout: 'ignore',
          stderr: 'ignore',
          env: { SOCIAL_HARNESS_BOOTSTRAP: stableEntry },
          extendEnv: true,
        }),
      )
      .pipe(Effect.timeout('15 seconds'), Effect.result);
    if (startup._tag === 'Failure' || Number(startup.success) !== 0) {
      const rollback = yield* upgrades.rollback();
      if (rollback.status !== 'rolledBack' || active === undefined) {
        return yield* Effect.fail(
          UpgradeError.make({
            operation: 'bootstrap',
            reason:
              'The selected software release could not start and no verified rollback is available.',
          }),
        );
      }
      cli =
        rollback.currentVersion === active.baseline
          ? baselineCli
          : path.join(
              paths.runtime,
              'versions',
              rollback.currentVersion,
              'node_modules',
              'social-harness',
              'dist',
              'cli.js',
            );
      yield* Console.warn(
        `Software update could not start; restored Social Harness ${rollback.currentVersion}.`,
      );
    }
  }
  const exitCode = yield* spawner.exitCode(
    ChildProcess.make(process.execPath, [cli, ...cliArguments], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
      env: { SOCIAL_HARNESS_BOOTSTRAP: stableEntry },
      extendEnv: true,
    }),
  );
  yield* Effect.sync(() => {
    process.exitCode = Number(exitCode);
  });
});

bootstrap.pipe(Effect.provide(recoveryLayer), NodeRuntime.runMain);
