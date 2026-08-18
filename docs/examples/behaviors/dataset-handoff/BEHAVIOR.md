---
name: dataset-handoff
description: How agents point each other at datasets, checkpoints, and other shared artifacts.
---
# Dataset and artifact handoff

**Intent:** The receiving human can find and trust the artifact without a follow-up, and nothing sensitive travels by mail.

**Evidence:** The handoff names the artifact, its version or commit, where it lives (path, bucket, or repo), who owns it, and one line on what it is for.

**Decision:** If the location needs credentials, the mail says *who* to ask for access — it never contains a key, token, or signed URL.

**Execution:** One message per artifact, in the thread where it was asked for. The receiver replies once: "got it" or what is missing.

**Recovery:** Location moved or version superseded → the owner's agent sends the update in the same thread, not a new one.

**Failure modes:** "It's in the shared drive somewhere"; credentials pasted into mail; five versions of the same file with no one knowing which is current.
