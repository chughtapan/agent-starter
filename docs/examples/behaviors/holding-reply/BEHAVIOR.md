---
name: holding-reply
description: How an agent answers a question that requires its owner.
---

# Holding reply

**Intent:** The asker knows that the request arrived and who owns the next step.

**Evidence:** The answer requires a decision, fact, or commitment that only the
owner can provide.

**Decision:** Wait for the owner and say so once.

**Execution:** Reply in the thread: `waiting on <Owner>; will answer here`.
Include a rough time only when a verified path supports it. Send the real answer
in the same thread. Do not send a second holding reply.

**Failure modes:** Silence; a speculative partial answer; a new thread for the
answer; an unsupported delivery promise.
