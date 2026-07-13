# Research: Backend Docker Memory Optimization

## R1: googleapis Package Replacement

**Decision**: Replace monolithic `googleapis@171.4.0` with `@googleapis/gmail@12.0.1` + `@googleapis/calendar@9.8.0` + `google-auth-library@9.15.0`.

**Rationale**: The monolithic package bundles 322+ API clients (194MB in node_modules). Only Gmail v1 and Calendar v3 are used. Individual packages are generated from the same Google Discovery documents and expose identical API surfaces via a different import pattern (`gmail({...})` instead of `google.gmail({...})`).

**Alternatives considered**:
- Keep `googleapis` and tree-shake at build time — rejected: googleapis does not support tree-shaking; it's CommonJS with dynamic requires.
- Use REST API directly without SDK — rejected: would require reimplementing OAuth token refresh, pagination, and error handling.

**Key finding**: `google-auth-library` must be pinned to `^9.15.0` (not `^10.x`) to avoid type incompatibility. The individual googleapis packages depend on `googleapis-common@7.2.0`, which depends on `google-auth-library@9.x`. Using v10 as a direct dependency creates two incompatible `OAuth2Client` types.

## R2: ts-node + nodemon → tsx

**Decision**: Replace `ts-node` + `nodemon` with `tsx` (ESBuild-based TypeScript executor).

**Rationale**: `ts-node` loads the TypeScript compiler into memory (~150MB), compiles each file on-demand, and keeps the AST in memory. `tsx` uses ESBuild (native Go binary) for near-instant transpilation with minimal memory overhead. `tsx watch` provides the same file-watching capability as `nodemon`.

**Alternatives considered**:
- `ts-node` with `--transpileOnly` — reduces memory but still loads the TS compiler.
- `swc-node` — similar approach to tsx but less maintained.
- Pre-compile with `tsc` + `nodemon --watch dist` — adds build step latency to dev workflow.

**Key finding**: `ts-node` is kept in devDependencies because `ts-jest` depends on it for running TypeScript test configuration. Only `nodemon` is removed.

## R3: Multi-Stage Docker Build

**Decision**: 4-stage Dockerfile: deps (shared npm ci + prisma generate) → builder (tsc) → dev (all deps for hot-reload) → production (compiled JS + prod deps only).

**Rationale**: The `deps` stage is shared between `builder` and `dev` to avoid duplicate `npm ci` runs. The `production` stage starts fresh from `node:22-alpine` with `npm ci --omit=dev`, then copies compiled output and Prisma assets from the builder.

**Alternatives considered**:
- 2-stage build (builder + production) — simpler but requires separate dev flow outside Docker.
- Build args for dev/prod — rejected: separate stages are cleaner and more cacheable.

**Key finding**: Prisma CLI must be copied from the builder stage because it's a devDependency but needed at startup for `prisma migrate deploy`. The `@prisma/client` runtime and query engine binaries are also copied since `npm ci --omit=dev` installs `@prisma/client` but its generated output (in `.prisma/client/`) is only produced by `prisma generate`.

## R4: `@shared/*` Path Aliases in Production

**Decision**: No runtime path resolution needed. All `@shared/*` imports are type-only and erase at compile time.

**Rationale**: Verified that all 3 imports from `@shared/types` in `backend/src/types/index.ts` use `export type` syntax. The compiled JavaScript output in `dist/` has no references to `../shared/`. No `tsc-alias` or `tsconfig-paths` is needed.

## R5: Calculator Tool Removal

**Decision**: Remove `mathjs` and the `calculator` tool entirely.

**Rationale**: The calculator tool is rarely used and `mathjs` adds ~8MB to node_modules. Removing it reduces both image size and attack surface. Frontend references in ChatInput and ChatContainer are also cleaned up.
