# Native Codex trust for evaluations

`index.ts` exposes the optional contributor trust operation. `service.ts` checks
the isolated ownership manifest and exact installed hooks before changing any
native state. Its private helpers perform bounded initialized app-server
requests using Effect process services. `schema.ts` decodes the installed native
protocol.

Only the current hashes for enabled, owned Social Harness commands are written
through `config/batchWrite`. A fresh process rereads native trust. Unrelated and
disabled hooks retain their prior state. This module does not calculate hashes,
edit TOML, or create another trust database. Product setup and automatic
upgrades do not call it.
