# Native conversation evidence

Import graders through `index.ts`. The module decodes Claude stream JSON and
Codex exec JSON into assistant text, attempted and successful tool calls, native
conversation IDs, and hook observations. Tool stdout and hidden hook context
never count as assistant text.

One successful tool result can contain several CLI outputs. The grader frames
complete top-level JSON objects and arrays across textual separators, respecting
nested containers, quoted braces, and escaped characters, then decodes each
document through its schema. Nested objects and JSON quoted inside another
document are not promoted to command evidence. An incomplete or malformed
document cannot establish a receipt or registration.

`checkVisibilityProtocol` separately checks native event order. A successful
`present` registration must refer to its `updates` receipt and native host. The
exact returned board must appear in an assistant message. Selected message IDs
must also have been retrieved with `items` and described with their source
outside the board. The roundtrip scenarios add the known fixture outcome and the
exact delivered message IDs to this check.

For the declared pair, source attribution uses the exact canonical sender inbox
to find the fixture's agent name. Provider display names such as `AgentMail`
cannot replace that identity. An unrelated inbox cannot borrow the same name.

The evaluator reads immutable acknowledgements created during that native turn.
A passing record must identify the same host, receipt, pending request, and
selected message IDs, and its `assistantTextHash` must match the actual complete
assistant message. Hashing replaces CRLF with LF and trims surrounding
whitespace. A staged draft may be a substring of that message. Registration
alone, legacy acknowledgements, stale records, and other-host confirmations do
not establish visibility. An agent-issued `host-hook` command is rejected as
fabricated native evidence.

Direct `presented` assertions cannot establish Claude or Codex visibility. The
observed premature-acknowledgement pattern remains a regression: a later final
claim cannot repair a call that occurred before any assistant text.

This is an evidence gate, not a proof that arbitrary prose faithfully summarizes
mail. Review the visible transcript as well. The checker requires observable
native command results and literal receipt and message IDs. Hidden execution or
an output format it cannot decode does not establish a pass. Mailbox state is
checked independently using metadata from AgentMail.

Tests replay sanitized native events, including the observed failure where an
agent acknowledged hidden stdout before its first assistant message. Private
live transcripts remain in the disposable evaluation root.
