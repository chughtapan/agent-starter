# Application workflows

Commissioning, legacy migration, background polling, and host commands
coordinate public feature APIs. They provide no transport or storage
implementations. Each module exposes its operations through `index.ts`. The root
CLI and Layers compose these workflows for the installed executable.
