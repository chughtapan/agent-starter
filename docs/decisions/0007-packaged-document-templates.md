# 0007: Package generated documents as templates

- Status: Accepted
- Date: 2026-08-27

## Context

Social Harness installs agent instructions, a collaboration protocol, a host
skill, onboarding messages, a roster, and scheduler configuration. Embedding
these documents in TypeScript made product copy difficult to review, encouraged
duplicate renderers, and coupled editorial changes to control flow.

The documents contain validated identity and path values. They must ship in the
npm package, render deterministically without network access, and preserve
Markdown or XML escaping rules.

## Decision

Store generated documents in `templates/` as Nunjucks templates. Treat Nunjucks
as the Jinja-compatible template language for this product. Expose semantic
rendering operations through the Effect `DocumentTemplates` service, and provide
that service once in the application Layer graph.

Keep ordinary short CLI status lines in TypeScript. Put durable instructions,
prompts, outbound message bodies, and generated configuration documents in
templates. Test the packaged source templates with concrete Alice, Bob, and
Carol data.

## Rationale

Reviewers can now evaluate product language directly as documents. A typed
service keeps template paths and rendering failures out of workflow modules.
Nunjucks supports the required Markdown substitutions and XML escaping without a
custom interpolation language, and it works locally in Node.js.

## Consequences

- The npm package must include `templates/`.
- A missing or invalid template is a typed `TemplateError`.
- Template changes require rendering tests for the resulting document, not
  snapshots of implementation calls.
- Template data remains Schema-decoded before rendering.
- Package smoke tests must prove that templates resolve from installed output.

## Alternatives considered

### Keep multiline strings in TypeScript

Rejected because editorial content remains mixed with control flow and is easy
to duplicate across onboarding, migration, and adapters.

### Build a custom placeholder replacer

Rejected because it would recreate escaping, missing-value checks, and syntax
rules already provided by a maintained template engine.

### Fetch prompts from a hosted service

Rejected because onboarding and local collaboration must work without a second
network dependency, and remotely changing agent instructions would weaken
reviewability and release control.

### Generate files with a general-purpose configuration library

Rejected because Markdown instructions and outbound mail are documents, not
configuration objects. A document template is clearer and easier to review.
