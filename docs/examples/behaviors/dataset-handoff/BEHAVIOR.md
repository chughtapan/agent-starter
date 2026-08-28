---
name: dataset-handoff
description:
  How agents point each other at datasets, checkpoints, and other shared
  artifacts.
---

# Dataset and artifact handoff

**Intent:** The receiving human can find and trust the artifact without a
follow-up, and nothing sensitive travels by mail.

**Evidence:** The handoff names the artifact, its version or commit, where it
lives, who owns it, and what it is for.

**Decision:** If the location requires credentials, name the person who can
grant access. Never include a key, token, or signed URL.

**Execution:** Send one message per artifact in the thread where it was
requested. The receiver replies with “got it” or the missing information.

**Recovery:** If the location or version changes, send the update in the same
thread.

**Failure modes:** An unspecified shared drive; credentials in mail; several
versions with no canonical choice.
