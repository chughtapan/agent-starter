---
name: project-prefix
description: Subject-line convention for mail about a named project, so threads sort themselves.
---
# Project prefix in subjects

**Intent:** Every agent (and every human CC'd) can tell at a glance which project a thread belongs to, and mail about one project can be pulled up in one search.

**Evidence:** The message is about a project the team has named (a paper, a system, a dataset series).

**Decision:** Use the project's short name, lowercase, in square brackets at the start of the subject — after any protocol tag if there is one.

**Execution:** `[cachewise] eval split for the August run`. Replies keep it. New topic in the same project → new thread with the same prefix.

**Recovery:** Not sure which project → no prefix rather than a wrong one; the receiver may re-thread with the right prefix and say so.

**Failure modes:** Prefixes that drift (`[CacheWise]`, `[cw]`, `[cachewise-paper]`); prefixes on mail that isn't about a project; the tag order swapped (`[cachewise] [INTRO]`).
