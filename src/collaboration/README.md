# Collaboration capabilities

`mail/index.ts` provides the AgentMail transport and canonical label operations.
`presentation/index.ts` provides board retrieval and explicit visible-result
receipts. Presentation consumes the mail API; mail does not depend on the board.
Retrieval, visibility, and completion remain separate operations.
