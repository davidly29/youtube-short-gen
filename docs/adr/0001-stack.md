# ADR 0001: Monorepo stack

- Status: accepted (E0-01)
- Date: 2026-10-18

## Decision

pnpm workspaces + Turborepo, Node 22, TypeScript 6.0 strict (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`),
ESLint 9 flat config with `typescript-eslint` strict, Prettier, Vitest. Next.js 16 (App Router) for `apps/web`.

Internal packages (`packages/*`) export TypeScript source directly (`"exports": "./src/index.ts"`) with
`moduleResolution: Bundler`; there is no per-package build step. Apps that run under Node (worker, mcp) will use `tsx`.

## Why

- TypeScript 7 (native) is the latest release, but `typescript-eslint` supports `<6.1`; 6.0 keeps linting on types working.
- Source-exported internal packages keep agent tickets small: no build ordering or `dist/` drift between packages.

## Revisit when

`typescript-eslint` supports TypeScript 7, or a package needs to be published to npm.
