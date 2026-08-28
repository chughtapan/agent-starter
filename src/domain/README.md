# Domain schemas

This directory contains current, versioned data contracts. Configuration,
identity, collaboration state, and runtime ownership are separate so a caller
depends only on the contract it uses.

Runtime modules import only the cohesive contract file they use.

Earlier formats do not belong here. Keep all detection and conversion for those
formats in `src/migration.ts`.
