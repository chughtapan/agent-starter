# Document templates

This directory contains documents that Social Harness installs or sends. The
runtime renders them with Nunjucks through `src/platform/documents/index.ts`.

- `agent/` contains the installed identity, protocol, and host skill.
- `onboarding/` contains the facilitator introduction and initial roster.
- `scheduler/` contains the macOS LaunchAgent.

Use Nunjucks variables for validated values. Keep workflow decisions in
TypeScript, not in template conditionals. Add or update a rendering test in
`tests/platform/templates.test.ts` whenever a template contract changes.
