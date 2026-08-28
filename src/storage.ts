/**
 * @file Provides private atomic persistence and append-only event recording.
 */

import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';

import type { HarnessEvent } from './domain/runtime.js';
import { StorageError } from './errors.js';

/** Provides atomic, private persistence for user-owned runtime data. */
export interface StorageService {
  readonly ensureDirectory: (path: string) => Effect.Effect<void, StorageError>;
  readonly exists: (path: string) => Effect.Effect<boolean, StorageError>;
  readonly readText: (
    path: string,
  ) => Effect.Effect<string | undefined, StorageError>;
  readonly readJson: (path: string) => Effect.Effect<unknown, StorageError>;
  readonly remove: (path: string) => Effect.Effect<void, StorageError>;
  readonly writeText: (
    path: string,
    content: string,
    mode?: number,
  ) => Effect.Effect<void, StorageError>;
  readonly writeJson: (
    path: string,
    value: unknown,
  ) => Effect.Effect<void, StorageError>;
  readonly appendEvent: (
    path: string,
    event: HarnessEvent,
  ) => Effect.Effect<void, StorageError>;
}

/** Identifies local Social Harness persistence. */
export class Storage extends Context.Service<Storage, StorageService>()(
  'social-harness/Storage',
) {}

function makeStorageError(
  operation: string,
  path: string,
): (cause: unknown) => StorageError {
  return (cause: unknown) => StorageError.make({ operation, path, cause });
}

/** Provides storage backed by Effect's platform filesystem service. */
export const storageLayer = Layer.effect(Storage)(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;

    const ensureDirectory = Effect.fn('Storage.ensureDirectory')(function* (
      path: string,
    ) {
      yield* fileSystem
        .makeDirectory(path, { recursive: true, mode: 0o700 })
        .pipe(
          Effect.flatMap(() => fileSystem.chmod(path, 0o700)),
          Effect.mapError(makeStorageError('ensureDirectory', path)),
        );
    });

    const exists = Effect.fn('Storage.exists')(function* (path: string) {
      return yield* fileSystem
        .exists(path)
        .pipe(Effect.mapError(makeStorageError('exists', path)));
    });

    const readText = Effect.fn('Storage.readText')(function* (path: string) {
      const present = yield* exists(path);
      if (!present) {
        return undefined;
      }
      return yield* fileSystem
        .readFileString(path)
        .pipe(Effect.mapError(makeStorageError('readText', path)));
    });

    const readJson = Effect.fn('Storage.readJson')(function* (path: string) {
      const content = yield* readText(path);
      if (content === undefined) {
        return undefined;
      }
      return yield* Effect.try({
        try: (): unknown => {
          const value: unknown = JSON.parse(content);
          return value;
        },
        catch: makeStorageError('parseJson', path),
      });
    });

    const remove = Effect.fn('Storage.remove')(function* (path: string) {
      if (!(yield* exists(path))) {
        return;
      }
      yield* fileSystem
        .remove(path, { recursive: true })
        .pipe(Effect.mapError(makeStorageError('remove', path)));
    });

    const writeText = Effect.fn('Storage.writeText')(function* (
      path: string,
      content: string,
      mode?: number,
    ) {
      const effectiveMode = mode ?? 0o600;
      const directory = pathService.dirname(path);
      yield* ensureDirectory(directory);
      const temporaryPath = yield* fileSystem
        .makeTempFile({ directory, prefix: `.${pathService.basename(path)}.` })
        .pipe(Effect.mapError(makeStorageError('makeTempFile', path)));
      const write = fileSystem.writeFileString(temporaryPath, content).pipe(
        Effect.flatMap(() => fileSystem.chmod(temporaryPath, effectiveMode)),
        Effect.flatMap(() => fileSystem.rename(temporaryPath, path)),
        Effect.mapError(makeStorageError('writeText', path)),
      );
      yield* write.pipe(
        Effect.onError(() =>
          fileSystem.remove(temporaryPath).pipe(Effect.ignore),
        ),
      );
    });

    const writeJson = Effect.fn('Storage.writeJson')(function* (
      path: string,
      value: unknown,
    ) {
      const content = yield* Effect.try({
        try: () => `${JSON.stringify(value, null, 2)}\n`,
        catch: makeStorageError('stringifyJson', path),
      });
      yield* writeText(path, content);
    });

    const appendEvent = Effect.fn('Storage.appendEvent')(function* (
      path: string,
      event: HarnessEvent,
    ) {
      const directory = pathService.dirname(path);
      yield* ensureDirectory(directory);
      const line = yield* Effect.try({
        try: () => `${JSON.stringify(event)}\n`,
        catch: makeStorageError('stringifyEvent', path),
      });
      yield* fileSystem
        .writeFileString(path, line, { flag: 'a', mode: 0o600 })
        .pipe(Effect.mapError(makeStorageError('appendEvent', path)));
    });

    return {
      ensureDirectory,
      exists,
      readText,
      readJson,
      remove,
      writeText,
      writeJson,
      appendEvent,
    };
  }).pipe(Effect.withSpan('storageLayer')),
);
