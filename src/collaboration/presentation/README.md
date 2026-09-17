# Visible collaboration updates

`index.ts` exposes the board and receipt services. Retrieval refreshes the
cached mail view and issues a snapshot receipt containing its rendered board
without consuming visibility. `receipts.ts` records visibility separately from
explicit mail completion.

For Claude and Codex, `prepare` stores an immutable request under
`state/pending-presentations/`. The request contains the exact draft, receipt,
host, selected message IDs, and draft hash. It must include the retrieved board
and text beyond the board when selecting results. This check establishes text
presence; it does not judge the meaning or quality of a result. Preparing
changes neither visibility nor mail labels.

The application edge passes the native Stop event's actual assistant message to
`confirm`. Confirmation requires the normalized draft to occur in that message
for the same host. Normalization replaces CRLF with LF and trims surrounding
whitespace only. A matching acknowledgement records `nativeConfirmed`, the
matching `pendingRequestId`, and `assistantTextHash` for the full normalized
assistant message. If several drafts overlap, the longest matching draft wins.
Each receipt, host, and selected message set produces at most one native
acknowledgement. OpenClaw and manual callers retain `acknowledge`.

Acknowledgements live in private immutable files under
`state/acknowledgements/`. Each record contains the retrieved snapshot, the time
it was shown, and the messages that were visible. Reading the board unions those
messages across records and selects its signature by snapshot issue order.
Unconfirmed Claude and Codex records contribute no visible message IDs. A
host-specific read reports `nativeConfirmed` from its latest record, so older
proof cannot promote a newer self-assertion. Concurrent hosts preserve each
other's confirmed results. Retrying a confirmation does not refresh its
presentation time or create another acknowledgement.

The previous `state/presentation.json` file remains intact as a baseline for
global visibility. It cannot establish host-specific evidence. The first new
acknowledgement establishes snapshot order because the previous format recorded
only presentation time. Global reads ignore unconfirmed native records while
preserving manual and OpenClaw compatibility. Records and drafts are retained;
there is no concurrent compaction or mutable shared acknowledgement file.

`api/index.ts` defines those services independently of their implementations.
Host event commands and setup diagnostics live at the application edge. Neither
mail content nor receipt metadata grants authority to execute instructions.
