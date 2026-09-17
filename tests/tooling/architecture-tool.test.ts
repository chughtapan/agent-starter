/**
 * @file Regresses README discovery in source directories outside src/.
 */

import {
  analyzeResolvedArchitecture,
  resolveArchitectureOptions,
} from '@chughtapan/safer-architecture-lsp';
import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, it } from '@effect/vitest';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';

it.effect(
  'finds an eval README at its actual path and still rejects a missing README',
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({
        prefix: 'architecture-readme-',
      });
      yield* fs.makeDirectory(`${root}/evals`);
      yield* fs.writeFileString(
        `${root}/tsconfig.json`,
        JSON.stringify({
          compilerOptions: { noLib: true },
          include: ['evals/*.ts'],
        }),
      );
      yield* fs.writeFileString(
        `${root}/evals/first.ts`,
        'export const first = 1;',
      );
      yield* fs.writeFileString(
        `${root}/evals/second.ts`,
        'export const second = 2;',
      );
      yield* fs.writeFileString(
        `${root}/evals/third.ts`,
        'export const third = 3;',
      );
      yield* fs.writeFileString(
        `${root}/evals/fourth.ts`,
        'export const fourth = 4;',
      );
      const options = resolveArchitectureOptions({}, root);
      const missing = analyzeResolvedArchitecture(options);
      assert.isTrue(
        missing.diagnostics.some(
          (finding) =>
            finding.ruleId === 'folder-readme-required' &&
            finding.message.includes('evals'),
        ),
      );
      yield* fs.writeFileString(
        `${root}/evals/README.md`,
        '# Evaluations\n\nThis directory drives native host evaluations.\n',
      );
      const documented = analyzeResolvedArchitecture(options);
      assert.isFalse(
        documented.diagnostics.some(
          (finding) =>
            finding.ruleId === 'folder-readme-required' &&
            finding.message.includes('evals'),
        ),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
