/**
 * @file Decodes, validates, loads, and saves Social Harness configuration.
 */

import * as Config from 'effect/Config';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Schema from 'effect/Schema';

import {
  HarnessConfig,
  makeDefaultConfig,
} from '../../domain/configuration.js';
import { Paths, Storage, type StorageError } from '../persistence/index.js';
import { ConfigurationError } from './errors.js';

/** Typed runtime configuration decoded by Effect's Config provider. */
export const harnessConfig = Config.schema(HarnessConfig);

/** Provides validated access to the public runtime configuration. */
export interface ConfigurationService {
  readonly load: () => Effect.Effect<
    HarnessConfig,
    ConfigurationError | StorageError
  >;
  readonly save: (
    config: HarnessConfig,
  ) => Effect.Effect<void, ConfigurationError | StorageError>;
}

/** Identifies validated Social Harness configuration. */
export class Configuration extends Context.Service<
  Configuration,
  ConfigurationService
>()('social-harness/Configuration') {}

/** Provides configuration backed by the private user-level JSON file. */
export const configurationLayer = Layer.effect(Configuration)(
  Effect.gen(function* () {
    const paths = yield* Paths;
    const storage = yield* Storage;

    const load = Effect.fn('Configuration.load')(function* () {
      const input = yield* storage.readJson(paths.config);
      if (input === undefined) {
        return makeDefaultConfig();
      }
      return yield* harnessConfig
        .parse(
          ConfigProvider.fromUnknown(input, { preserveEmptyStrings: true }),
        )
        .pipe(
          Effect.mapError(() =>
            ConfigurationError.make({
              field: 'config',
              reason:
                'configuration failed schema validation; inspect config.json',
            }),
          ),
        );
    });

    const save = Effect.fn('Configuration.save')(function* (
      config: HarnessConfig,
    ) {
      const encoded = yield* Schema.encodeEffect(HarnessConfig)(config).pipe(
        Effect.mapError(() =>
          ConfigurationError.make({
            field: 'config',
            reason:
              'configuration failed schema validation; inspect config.json',
          }),
        ),
      );
      yield* storage.writeJson(paths.config, encoded);
    });

    return { load, save };
  }).pipe(Effect.withSpan('configurationLayer')),
);
