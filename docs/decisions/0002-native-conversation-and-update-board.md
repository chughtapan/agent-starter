# 0002: Keep conversation as the work surface

- Status: Accepted
- Date: 2026-08-27

## Context

Users already have active Claude, Codex, or OpenClaw conversations. Early
concepts introduced dashboards, session tracking, or broad natural-language
triggers. Feedback showed that sessions are implementation detail, generic
questions collide with the coding harness, and results can be skipped in a wall
of text.

Users still need ambient awareness and an explicit way to know that a result is
not complete merely because it was shown.

## Decision

Use the current host conversation for all substantive work. Add a compact
`UPDATES` board only for ambient collaboration state. Activate collaboration
only for a named person or agent plus an action, a reply, an explicit skill, or
a configured routine. Keep results open until explicit owner completion.

## Rationale

This model adds collaboration where users already work while giving updates a
recognizable, repeatable visual shape. A narrow activation boundary lets Social
Harness coexist with each coding harness. Explicit completion prevents
scroll-past loss without turning the board into a task manager.

## Consequences

- Host adapters need consistent start/resume presentation.
- The board must stay compact, accessible, and free of substantive results.
- The runtime must track presentation separately from completion.
- Ambiguous “done” requires a short clarification when several items are open.

## Alternatives considered

### Build a collaboration dashboard application

Rejected because it creates a second work surface and adoption burden. The
dashboard-like visual language is useful only for compact updates.

### Show and route through all open sessions

Rejected because users do not need session inventory, and automatic session
selection is unreliable and confusing.

### Claim generic status or team questions

Rejected because those phrases already have valid meanings in coding harnesses
and ordinary conversation.

### Mark a result done when it is presented

Rejected because output can be missed in long conversations and presentation
does not prove owner acknowledgement.
