# Data Model: Backend Docker Memory Optimization

This feature does not introduce new data entities. It modifies infrastructure (Docker, dependencies, build toolchain) without changing the application's data model.

## Existing Entities (unchanged)

| Entity | Location | Impact |
|--------|----------|--------|
| Thread | `backend/prisma/schema.prisma` | No change |
| Message | `backend/prisma/schema.prisma` | No change |
| GmailTokenEntry | `backend/src/types/email.ts` | No change (tokens still file-based) |

## Infrastructure Entities (modified)

| Entity | Change |
|--------|--------|
| Dockerfile | Single-stage → 4-stage (deps, builder, dev, production) |
| docker-compose.yml | Production base config (was mixed dev/prod) |
| docker-compose.override.yml | New — dev overrides (volumes, tsx watch, NODE_ENV) |
| .dockerignore | New — root-level, excludes non-essential files from build context |
| Health endpoint | New `GET /health` → `{ status: "ok" }` |

## Dependency Changes

| Package | Before | After |
|---------|--------|-------|
| `googleapis` | `^171.4.0` (194MB) | Removed |
| `@googleapis/gmail` | — | `^12.0.0` (~2MB) |
| `@googleapis/calendar` | — | `^9.0.0` (~2MB) |
| `google-auth-library` | Transitive | `^9.15.0` (direct) |
| `mathjs` | `^15.2.0` | Removed |
| `tsx` | — | `^4.19.0` (devDep) |
| `nodemon` | `^3.1.14` (devDep) | Removed |
