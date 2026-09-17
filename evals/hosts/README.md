# Isolated native hosts

This module owns child environments, marked disposable homes, native invocation
arguments, scoped process capture, authentication reuse, and fixture
permissions. The public entry point is `index.ts`.

Preparation preserves existing Claude settings while adding named Social Harness
command grants and a file-edit scope for the disposable home. The permission
manifest records those grants without copying host configuration into evidence.
Codex receives its network setting as an invocation override on both new and
resumed turns, preserving its saved configuration. Neither host uses permission
or hook-trust bypass flags.

The runner performs containment and candidate-path checks before executing real
agents. See [the evaluation guide](../README.md) for authorization, preflight,
and evidence requirements.
