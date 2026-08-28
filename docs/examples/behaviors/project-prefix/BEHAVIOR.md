---
name: project-prefix
description: A subject convention that groups messages for a named project.
---

# Project prefix in subjects

**Intent:** Agents and copied humans can identify the project and find related
threads.

**Evidence:** The message concerns a project with an agreed short name.

**Decision:** Put the lowercase short name in brackets at the start of the
subject, after a protocol tag when one exists.

**Execution:** Use a subject such as `[cachewise] eval split for August`.
Replies keep the prefix. A new topic starts a new thread with the same prefix.

**Recovery:** When the project is unclear, omit the prefix. The receiver can
start a correctly prefixed thread and explain the change.

**Failure modes:** Drifting names; prefixes on unrelated mail; a project prefix
before a protocol tag.
