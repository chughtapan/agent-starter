# Local platform services

Configuration, packaged document rendering, and private persistence are separate
modules with `index.ts` entry points. Configuration can depend on persistence;
persistence depends only on platform services and shared value contracts. These
modules know nothing about mail presentation or application workflows.
