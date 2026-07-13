# Implementation Plan: Backend Docker Memory Optimization

**Feature ID**: `004-backend-docker-optimization`
**Branch**: `004-backend-docker-optimization`
**Status**: Implementation Complete

## Technical Context

| Area | Current State | Target State |
|------|--------------|-------------|
| Dependencies | `googleapis` (194MB, 322+ API clients) | `@googleapis/gmail` (~2MB) + `@googleapis/calendar` (~2MB) |
| Dev toolchain | `ts-node` + `nodemon` (in-memory TS compilation) | `tsx watch` (native ESBuild-based, lower memory) |
| Docker build | Single-stage, all deps, runs `npm run dev` | Multi-stage: deps → builder → dev / production |
| Container memory | ~2GB at idle | Target: <800MB via `--max-old-space-size=512` |
| Calculator tool | `mathjs` dependency (~8MB) | Removed entirely (tool + frontend references) |

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | PASS | TypeScript strict, structured pino logging, no dead code |
| II. Testing Standards | PASS | All 128 tests pass, mocks updated for new packages |
| III. UX Consistency | PASS | Frontend calculator references removed cleanly |
| IV. Performance | PASS | `--max-old-space-size=512` enforces memory budget |

## Phases Executed

### Phase 1: Remove Calculator Tool + mathjs
- Deleted `backend/src/tools/calculator.ts`
- Removed from `backend/src/tools/index.ts` (import + registration)
- Removed `mathjs` from `backend/package.json`
- Removed calculator from `app/src/components/ChatInput/ChatInput.tsx` TOOLS array
- Removed calculator from `app/src/components/ChatContainer/ChatContainer.tsx` default selectedTools

### Phase 2: Replace googleapis with Individual Packages
- Replaced `googleapis` with `@googleapis/gmail@12.0.1` + `@googleapis/calendar@9.8.0`
- Added `google-auth-library@^9.15.0` as direct dependency (aligned with googleapis sub-packages)
- Updated 4 source files: emailService.ts, googleCalendar.ts, gmailAuthRoutes.ts, google-auth.ts
- Updated 4 test files with new mock patterns (separate gmail + auth mocks)

### Phase 3: Replace ts-node + nodemon with tsx
- Added `tsx@^4.19.0` to devDependencies
- Replaced `nodemon` with `tsx`
- Updated `start` and `dev` scripts

### Phase 4: Add Health Endpoint
- Added `GET /health` returning `{ status: "ok" }` to server.ts
- Placed before auth middleware (publicly accessible)

### Phase 5: Multi-Stage Dockerfile
- 4-stage build: deps → builder → dev → production
- Production stage: `npm ci --omit=dev`, copies compiled JS + Prisma CLI from builder
- `node --max-old-space-size=512 dist/server.js` as production CMD
- Created root `.dockerignore`

### Phase 6: Split docker-compose
- `docker-compose.yml`: production base (NODE_ENV=production, target=production, health check)
- `docker-compose.override.yml`: dev overrides (volumes, tsx watch, target=dev)

## Artifacts Generated

| Artifact | Path |
|----------|------|
| Feature spec | `specs/004-backend-docker-optimization/spec.md` |
| Implementation plan | `specs/004-backend-docker-optimization/plan.md` |
| Research | `specs/004-backend-docker-optimization/research.md` |
| Data model | `specs/004-backend-docker-optimization/data-model.md` |

## Verification

- **Tests**: 17 suites, 128 tests — all pass
- **TypeScript build**: `tsc` compiles with zero errors
- **Docker verification**: Build and run `docker-compose -f docker-compose.yml up --build`, verify:
  - `curl http://localhost:5001/health` → `{"status":"ok"}`
  - `docker stats` → backend memory < 800MB
  - Image size < 500MB
