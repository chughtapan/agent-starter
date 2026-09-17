/**
 * @file Tests evidence classification and the isolated native process boundary.
 */

import * as NodeServices from '@effect/platform-node/NodeServices';
import { assert, describe, it } from '@effect/vitest';
import * as ConfigProvider from 'effect/ConfigProvider';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as PlatformError from 'effect/PlatformError';
import { FastCheck } from 'effect/testing';

import { TestIdentity } from '../../evals/domain/index.js';
import {
  checkDiscovery,
  checkMessageState,
  checkPeerReplyDelivery,
  checkRequestDelivery,
  checkSession,
  mailMutations,
  newPeerMessages,
  parseTranscript,
  redact,
} from '../../evals/evidence/index.js';
import {
  hostArguments,
  initializeRoot,
  isolatedEnvironment,
  prepareShellPath,
  profileAt,
  seedCodexAuthentication,
  verifyContainment,
} from '../../evals/hosts/index.js';
import { verifyMailIdentity } from '../../evals/mail-evidence.js';
import { oneShotPollArguments } from '../../evals/runner.js';

describe('native transcript evidence', () => {
  it('keeps hidden hook output out of visible assistant evidence', () => {
    const transcript = parseTranscript(
      'claude',
      [
        JSON.stringify({
          type: 'system',
          subtype: 'hook_response',
          session_id: 'native-session-123',
          output: 'READY secret-result',
        }),
        JSON.stringify({
          type: 'assistant',
          session_id: 'native-session-123',
          message: {
            content: [
              { type: 'text', text: 'The result is open.' },
              {
                type: 'tool_use',
                id: 'read-skill-123',
                name: 'Read',
                input: {
                  file_path: '/isolated/.claude/skills/social-harness/SKILL.md',
                },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          session_id: 'native-session-123',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'read-skill-123',
                content: 'Installed skill content.',
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'result',
          session_id: 'native-session-123',
          result: 'The result is open.',
        }),
      ].join('\n'),
    );
    assert.equal(transcript.visible, 'The result is open.');
    assert.lengthOf(transcript.hookEvents, 1);
    assert.equal(checkDiscovery(transcript).status, 'pass');
    assert.equal(checkSession(transcript, 'different-session').status, 'fail');
  });

  it('captures Codex native continuation IDs and actual tool commands', () => {
    const transcript = parseTranscript(
      'codex',
      [
        JSON.stringify({
          type: 'thread.started',
          thread_id: 'codex-thread-123',
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: 'social-harness updates --if-needed --json',
          },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: {
            type: 'command_execution',
            command: 'social-harness done --all',
          },
        }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: 'Shown to the owner.' },
        }),
      ].join('\n'),
    );
    assert.equal(checkSession(transcript, 'codex-thread-123').status, 'pass');
    assert.deepEqual(mailMutations(transcript), ['social-harness done --all']);
    assert.equal(transcript.visible, 'Shown to the owner.');
  });

  it('does not count denied or failed native reads as discovered skills', () => {
    const claude = parseTranscript(
      'claude',
      [
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'denied-read',
                name: 'Read',
                input: { file_path: '/isolated/social-harness/SKILL.md' },
              },
            ],
          },
        }),
        JSON.stringify({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'denied-read',
                is_error: true,
                content: 'Permission denied.',
              },
            ],
          },
        }),
      ].join('\n'),
    );
    const codex = parseTranscript(
      'codex',
      JSON.stringify({
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'cat /isolated/social-harness/SKILL.md',
          status: 'failed',
          exit_code: 1,
        },
      }),
    );
    assert.equal(checkDiscovery(claude).status, 'fail');
    assert.equal(checkDiscovery(codex).status, 'fail');
    assert.lengthOf(claude.toolCalls, 1);
    assert.lengthOf(codex.toolCalls, 1);
  });

  it('rejects old unread mail as evidence for a new peer result', () => {
    const oldMessage = {
      message_id: 'old-unread',
      labels: ['unread'],
      sender: 'carol@agentmail.to',
      recipients: ['alice@agentmail.to'],
    };
    const before = {
      threads: [
        { thread_id: 'test-thread', labels: [], messages: [oldMessage] },
      ],
    };
    const reply = {
      message_id: 'new-reply',
      labels: ['sh-done'],
      sender: 'carol@agentmail.to',
      recipients: ['alice@agentmail.to'],
    };
    const after = {
      threads: [
        { thread_id: 'test-thread', labels: [], messages: [oldMessage, reply] },
      ],
    };
    assert.deepEqual(newPeerMessages(before, 'carol@agentmail.to', before), []);
    assert.deepEqual(
      newPeerMessages(after, 'Carol@agentmail.to', before).map(
        (message) => message.message_id,
      ),
      ['new-reply'],
    );
    assert.deepEqual(
      newPeerMessages(after, 'someone-else@agentmail.to', before),
      [],
    );
    assert.equal(
      checkMessageState(after, ['new-reply'], 'open', 'reply').status,
      'fail',
    );
    assert.equal(
      checkMessageState(after, ['missing'], 'done', 'reply').status,
      'fail',
    );
    assert.equal(checkMessageState(after, [], 'open', 'reply').status, 'fail');
    assert.equal(
      checkMessageState(after, ['new-reply'], 'done', 'reply').status,
      'pass',
    );
    const threadPresented = {
      threads: [
        {
          thread_id: 'test-thread',
          labels: ['sh-presented'],
          messages: [
            {
              ...reply,
              labels: ['unread'],
            },
          ],
        },
      ],
    };
    assert.equal(
      checkMessageState(threadPresented, ['new-reply'], 'presented', 'reply')
        .status,
      'pass',
    );
  });

  it('proves a request from the recipient inbox when sent-only source mail is absent', () => {
    const sourceSnapshot = { threads: [] };
    const recipientSnapshot = {
      threads: [
        {
          thread_id: 'request-thread',
          labels: ['received', 'unread'],
          messages: [
            {
              message_id: 'request-message',
              labels: ['unread'],
              sender: 'alice@agentmail.to',
              recipients: ['carol@agentmail.to', 'owner+alice@example.test'],
            },
          ],
        },
      ],
    };
    const allowed = [
      'alice@agentmail.to',
      'carol@agentmail.to',
      'owner+alice@example.test',
      'owner+carol@example.test',
    ];
    assert.equal(
      checkRequestDelivery(
        sourceSnapshot,
        'alice@agentmail.to',
        'carol@agentmail.to',
        'owner+alice@example.test',
        allowed,
      ).status,
      'fail',
    );
    assert.equal(
      checkRequestDelivery(
        recipientSnapshot,
        'alice@agentmail.to',
        'carol@agentmail.to',
        'owner+alice@example.test',
        allowed,
      ).status,
      'pass',
    );
  });

  it('correlates a reply through the request message when inbox thread IDs differ', () => {
    const replySnapshot = {
      threads: [
        {
          thread_id: 'alice-local-thread',
          labels: ['received', 'unread'],
          messages: [
            {
              message_id: 'request-message',
              labels: ['sent'],
              sender: 'alice@agentmail.to',
              recipients: ['carol@agentmail.to', 'owner+alice@example.test'],
            },
            {
              message_id: 'reply-message',
              labels: ['unread'],
              sender: 'carol@agentmail.to',
              recipients: [
                'alice@agentmail.to',
                'owner+carol@example.test',
                'owner+alice@example.test',
              ],
            },
          ],
        },
      ],
    };
    const allowed = [
      'alice@agentmail.to',
      'carol@agentmail.to',
      'owner+alice@example.test',
      'owner+carol@example.test',
    ];
    assert.equal(
      checkPeerReplyDelivery(
        replySnapshot,
        ['request-message'],
        'carol@agentmail.to',
        'alice@agentmail.to',
        'owner+carol@example.test',
        allowed,
      ).status,
      'pass',
    );
    assert.equal(
      checkPeerReplyDelivery(
        replySnapshot,
        ['different-request'],
        'carol@agentmail.to',
        'alice@agentmail.to',
        'owner+carol@example.test',
        allowed,
      ).status,
      'fail',
    );
    const [replyThread] = replySnapshot.threads;
    if (replyThread === undefined) {
      throw new Error(
        'The reply fixture must include one requester-local thread.',
      );
    }
    const followUpSnapshot = {
      threads: [
        {
          ...replyThread,
          messages: [
            ...replyThread.messages,
            {
              message_id: 'follow-up-message',
              labels: ['unread'],
              sender: 'carol@agentmail.to',
              recipients: ['alice@agentmail.to', 'owner+carol@example.test'],
            },
          ],
        },
      ],
    };
    assert.equal(
      checkPeerReplyDelivery(
        followUpSnapshot,
        ['request-message'],
        'carol@agentmail.to',
        'alice@agentmail.to',
        'owner+carol@example.test',
        allowed,
        replySnapshot,
      ).status,
      'pass',
    );
  });

  it('does not treat host prose or malformed records as native evidence', () => {
    const transcript = parseTranscript(
      'codex',
      'I loaded the skill\n{"type":false}\n',
    );
    assert.equal(transcript.malformedLines, 2);
    assert.equal(checkSession(transcript).status, 'fail');
    assert.equal(checkDiscovery(transcript).status, 'fail');
  });

  it.prop(
    'redacts arbitrary structured token values',
    [FastCheck.string({ minLength: 1 })],
    ([secret]) => {
      assert.equal(
        redact(JSON.stringify({ access_token: secret })),
        '{"access_token":"[REDACTED]"}',
      );
    },
  );
});

describe('real host isolation', () => {
  it.effect(
    'keeps isolated shell customizations intact while refreshing an idempotent candidate PATH block',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-shell-path-',
        });
        const profile = profileAt(root, 'codex');
        yield* fs.makeDirectory(profile.home, { recursive: true });
        const existing =
          'export KEEP_ME="private eval setting"\nexport PATH=/usr/bin:/bin\n';
        yield* fs.writeFileString(`${profile.home}/.zprofile`, existing);
        yield* prepareShellPath(profile, `${root}/candidate bin`);
        const first = yield* fs.readFileString(`${profile.home}/.zprofile`);
        yield* prepareShellPath(profile, `${root}/candidate bin`);
        assert.equal(
          yield* fs.readFileString(`${profile.home}/.zprofile`),
          first,
        );
        assert.isTrue(first.startsWith(existing));
        assert.include(first, `${root}/candidate bin`);
        assert.include(
          yield* fs.readFileString(`${profile.home}/.zshrc`),
          `${root}/candidate bin`,
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live(
    'rechecks containment when a native cache file disappears after enumeration',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const root = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-rotation-',
        });
        const rotating = `${root}/rotating-backup`;
        yield* fs.writeFileString(rotating, 'temporary host cache');
        let enumerations = 0;
        const racing = FileSystem.FileSystem.of({
          ...fs,
          readDirectory: (directory) =>
            fs.readDirectory(directory, { recursive: true }).pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  enumerations++;
                  if (enumerations === 1) {
                    yield* fs.remove(rotating);
                  }
                }),
              ),
            ),
        });
        yield* verifyContainment(root).pipe(
          Effect.provideService(FileSystem.FileSystem, racing),
        );
        assert.equal(enumerations, 2);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live(
    'rescans for escapes after rotation instead of ignoring a disappeared path',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-rotation-escape-',
        });
        const root = `${parent}/isolated`;
        yield* fs.makeDirectory(root);
        const rotating = `${root}/rotating-backup`;
        const outside = `${parent}/outside`;
        yield* fs.writeFileString(rotating, 'temporary host cache');
        yield* fs.writeFileString(outside, 'protected fixture');
        let enumerations = 0;
        const racing = FileSystem.FileSystem.of({
          ...fs,
          readDirectory: (directory) =>
            fs.readDirectory(directory, { recursive: true }).pipe(
              Effect.tap(() =>
                Effect.gen(function* () {
                  enumerations++;
                  if (enumerations === 1) {
                    yield* fs.remove(rotating);
                    yield* fs.symlink(outside, `${root}/escape`);
                  }
                }),
              ),
            ),
        });
        const result = yield* verifyContainment(root).pipe(
          Effect.provideService(FileSystem.FileSystem, racing),
          Effect.result,
        );
        assert.equal(result._tag, 'Failure');
        assert.equal(enumerations, 2);
        assert.equal(yield* fs.readFileString(outside), 'protected fixture');
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.live('does not retry a permission failure during containment checks', () =>
    Effect.gen(function* () {
      let calls = 0;
      const fs = FileSystem.makeNoop({
        realPath: () =>
          Effect.suspend(() => {
            calls++;
            return Effect.fail(
              // eslint-disable-next-line agent-code-guard/manual-tagged-error -- Effect's platform-error factory requires the normalized OS tag in this fixture.
              PlatformError.systemError({
                _tag: 'PermissionDenied',
                module: 'FileSystem',
                method: 'realPath',
              }),
            );
          }),
      });
      const result = yield* verifyContainment('/isolated').pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.result,
      );
      assert.equal(result._tag, 'Failure');
      assert.equal(calls, 1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'requires both declared roster members before permitting a recovered mail pair',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-roster-test-',
        });
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-roster`,
        );
        const profile = profileAt(root, 'claude');
        const alice = TestIdentity.make({
          name: 'Alice',
          inbox: 'alice@agentmail.to',
          ownerEmail: 'owner+alice@example.test',
        });
        const carol = TestIdentity.make({
          name: 'Carol',
          inbox: 'carol@agentmail.to',
          ownerEmail: 'owner+carol@example.test',
        });
        const allowed = [
          'alice@agentmail.to',
          'carol@agentmail.to',
          'owner+alice@example.test',
          'owner+carol@example.test',
        ];
        yield* fs.makeDirectory(`${profile.harness}/state`, {
          recursive: true,
        });
        yield* fs.makeDirectory(`${profile.harness}/agent`, {
          recursive: true,
        });
        yield* fs.writeFileString(
          `${profile.harness}/state/identity.json`,
          JSON.stringify({
            agentName: alice.name,
            agentEmail: alice.inbox,
            ownerEmail: alice.ownerEmail,
          }),
        );
        yield* fs.writeFileString(
          `${profile.agentmail}/inbox`,
          'alice@agentmail.to',
        );
        yield* fs.writeFileString(`${profile.agentmail}/key`, 'fixture-key');
        yield* fs.writeFileString(
          `${profile.harness}/agent/PROTOCOL.md`,
          'Only the configured test pair.',
        );
        const rosterPath = `${profile.harness}/agent/roster.md`;
        const aliceRow = '|Alice|alice@agentmail.to|owner+alice@example.test|';
        yield* fs.writeFileString(rosterPath, aliceRow);
        const incomplete = yield* verifyMailIdentity(
          profile,
          alice,
          allowed,
          carol,
        ).pipe(Effect.result);
        assert.equal(incomplete._tag, 'Failure');
        yield* fs.writeFileString(
          rosterPath,
          `${aliceRow}\n|Carol|carol@agentmail.to|owner+carol@example.test|`,
        );
        yield* verifyMailIdentity(profile, alice, allowed, carol);
        yield* fs.writeFileString(
          rosterPath,
          `${aliceRow}\n|Elsewhere|outside@example.test|`,
        );
        const outside = yield* verifyMailIdentity(
          profile,
          alice,
          allowed,
          carol,
        ).pipe(Effect.result);
        assert.equal(outside._tag, 'Failure');
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ HOME: '/actual-home' }),
            ),
          ),
        ),
      ),
  );

  it('requires opt-in to share Claude credential storage and keeps customization isolated', () => {
    const root = '/isolated/social-harness-eval-test';
    const standard = isolatedEnvironment(
      profileAt(root, 'claude'),
      '/usr/bin',
      '/native/.claude',
    );
    assert.notProperty(standard, 'CLAUDE_SECURESTORAGE_CONFIG_DIR');
    const reused = isolatedEnvironment(
      profileAt(root, 'claude', true),
      '/usr/bin',
      '/native/.claude',
    );
    assert.equal(reused.CLAUDE_SECURESTORAGE_CONFIG_DIR, '/native/.claude');
    assert.equal(reused.CLAUDE_CONFIG_DIR, `${root}/homes/claude/.claude`);
    assert.equal(reused.HOME, `${root}/homes/claude`);
    assert.equal(reused.AGENTMAIL_HOME, `${root}/homes/claude/.agentmail`);
    const codex = isolatedEnvironment(
      profileAt(root, 'codex', true),
      '/usr/bin',
      '/native/.claude',
    );
    assert.notProperty(codex, 'CLAUDE_SECURESTORAGE_CONFIG_DIR');
  });

  it.effect.prop(
    'seeds only a private Codex auth cache and preserves native and refreshed files',
    [FastCheck.string()],
    ([token]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-auth-test-',
        });
        const nativeHome = `${parent}/native`;
        yield* fs.makeDirectory(`${nativeHome}/.codex`, { recursive: true });
        const original = JSON.stringify({ tokens: { access_token: token } });
        yield* fs.writeFileString(`${nativeHome}/.codex/auth.json`, original, {
          mode: 0o600,
        });
        yield* fs.writeFileString(
          `${nativeHome}/.codex/config.toml`,
          'production-settings',
        );
        const configuration = ConfigProvider.layer(
          ConfigProvider.fromUnknown({ HOME: nativeHome }),
        );
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-auth`,
        ).pipe(Effect.provide(configuration));
        yield* seedCodexAuthentication(root).pipe(
          Effect.provide(configuration),
        );
        const destination = `${root}/homes/codex/.codex/auth.json`;
        assert.equal(yield* fs.readFileString(destination), original);
        assert.equal((yield* fs.stat(destination)).mode & 0o777, 0o600);
        assert.isFalse(
          yield* fs.exists(`${root}/homes/codex/.codex/config.toml`),
        );
        yield* fs.writeFileString(
          destination,
          '{"tokens":{"access_token":"refreshed-test-token"}}',
        );
        yield* seedCodexAuthentication(root).pipe(
          Effect.provide(configuration),
        );
        assert.equal(
          yield* fs.readFileString(destination),
          '{"tokens":{"access_token":"refreshed-test-token"}}',
        );
        assert.equal(
          yield* fs.readFileString(`${nativeHome}/.codex/auth.json`),
          original,
        );
        yield* verifyContainment(root);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect(
    'rejects an invalid auth cache without exposing it or leaving a destination',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-auth-test-',
        });
        const nativeHome = `${parent}/native`;
        yield* fs.makeDirectory(`${nativeHome}/.codex`, { recursive: true });
        yield* fs.writeFileString(
          `${nativeHome}/.codex/auth.json`,
          'invalid-sensitive-fixture',
          { mode: 0o600 },
        );
        const configuration = ConfigProvider.layer(
          ConfigProvider.fromUnknown({ HOME: nativeHome }),
        );
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-invalid-auth`,
        ).pipe(Effect.provide(configuration));
        const result = yield* seedCodexAuthentication(root).pipe(
          Effect.provide(configuration),
          Effect.result,
        );
        assert.equal(result._tag, 'Failure');
        if (result._tag === 'Failure') {
          assert.notInclude(
            JSON.stringify(result.failure),
            'invalid-sensitive-fixture',
          );
        }
        assert.deepEqual(
          yield* fs.readDirectory(`${root}/homes/codex/.codex`),
          [],
        );
        assert.equal(
          yield* fs.readFileString(`${nativeHome}/.codex/auth.json`),
          'invalid-sensitive-fixture',
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it('sets all native homes and manual scheduling without retaining arbitrary production env', () => {
    const profile = profileAt('/isolated/social-harness-eval-test', 'codex');
    const environment = isolatedEnvironment(profile, '/candidate/bin:/usr/bin');
    assert.equal(environment.HOME, profile.home);
    assert.equal(environment.SOCIAL_HARNESS_USER_HOME, profile.home);
    assert.equal(environment.CODEX_HOME, `${profile.home}/.codex`);
    assert.equal(environment.SOCIAL_HARNESS_SCHEDULER_MODE, 'manual');
    assert.notProperty(environment, 'AGENTMAIL_API_KEY');
    assert.notProperty(environment, 'SOCIAL_HARNESS_LAUNCHD_LABEL');
  });

  it('runs a bounded one-shot poll between native turns', () => {
    assert.deepEqual(oneShotPollArguments('dist/cli.js'), [
      'dist/cli.js',
      'poll',
      '--once',
    ]);
  });

  it.prop(
    'uses exact resume IDs and never weakens native trust or sandboxing',
    [FastCheck.uuid()],
    ([sessionId]) => {
      for (const host of ['claude', 'codex'] satisfies Array<
        'claude' | 'codex'
      >) {
        const args = hostArguments(
          profileAt('/isolated/social-harness-eval-test', host),
          'continue',
          sessionId,
        );
        assert.include(args, sessionId);
        assert.notInclude(args, '--last');
        if (host === 'codex') {
          assert.include(
            args,
            'sandbox_workspace_write.writable_roots=["/isolated/social-harness-eval-test/homes/codex"]',
          );
        }
        assert.notMatch(
          args.join(' '),
          /bypass|skip-permissions|ignore-user-config|safe-mode|--bare/,
        );
      }
    },
  );

  it.effect('refuses an unmarked existing root before writing profiles', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped({
        prefix: 'evals-test-',
      });
      const root = `${parent}/social-harness-eval-existing`;
      yield* fs.makeDirectory(root);
      yield* fs.writeFileString(`${root}/user-data`, 'preserve');
      const result = yield* initializeRoot(root).pipe(Effect.result);
      assert.equal(result._tag, 'Failure');
      assert.deepEqual(yield* fs.readDirectory(root), ['user-data']);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ HOME: '/actual-home' }),
          ),
        ),
      ),
    ),
  );

  it.effect(
    'permits only native Codex temporary aliases to an executable binary',
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const parent = yield* fs.makeTempDirectoryScoped({
          prefix: 'evals-test-',
        });
        const root = yield* initializeRoot(
          `${parent}/social-harness-eval-native-alias`,
        );
        const aliasDirectory = `${root}/homes/codex/.codex/tmp/arg0/codex-arg0abc123`;
        yield* fs.makeDirectory(`${parent}/bin`);
        yield* fs.writeFileString(
          `${parent}/bin/codex`,
          '#!/bin/sh\nexit 0\n',
          { mode: 0o700 },
        );
        yield* fs.makeDirectory(aliasDirectory, { recursive: true });
        yield* fs.symlink(
          `${parent}/bin/codex`,
          `${aliasDirectory}/apply_patch`,
        );

        yield* verifyContainment(root);
        yield* fs.chmod(`${parent}/bin/codex`, 0o600);
        const invalid = yield* verifyContainment(root).pipe(Effect.result);

        assert.equal(invalid._tag, 'Failure');
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Layer.mergeAll(
            NodeServices.layer,
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({ HOME: '/actual-home' }),
            ),
          ),
        ),
      ),
  );

  it.effect('rejects a native profile auth symlink outside the eval root', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const parent = yield* fs.makeTempDirectoryScoped({
        prefix: 'evals-test-',
      });
      const root = yield* initializeRoot(
        `${parent}/social-harness-eval-contained`,
      );
      yield* fs.writeFileString(`${parent}/provider-auth`, 'never-read');
      yield* fs.symlink(
        `${parent}/provider-auth`,
        `${root}/homes/codex/.codex/auth.json`,
      );
      const result = yield* verifyContainment(root).pipe(Effect.result);
      assert.equal(result._tag, 'Failure');
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({ HOME: '/actual-home' }),
          ),
        ),
      ),
    ),
  );
});
