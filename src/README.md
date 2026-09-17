# Runtime source

This directory contains the host-neutral Social Harness runtime. Feature modules
expose their supported API through `index.ts`. Other modules import that entry
point; implementation files import their own internal contracts. `layers.ts`
assembles production services, and `cli.ts` is the process boundary.

Application workflows live in `application/`; mail and visibility live in
`collaboration/`; local configuration, documents, and persistence live in
`platform/`. `hosts/` owns native installation, and `upgrades/` owns release
activation and recovery. Versioned value contracts live in `domain/`.

Application workflows depend on feature APIs. Features depend on platform APIs
and value contracts. Platform services never import application workflows. The
architecture configuration enforces module entry points and this direction.
Packaged agent documents live in `templates/`, outside this directory.
