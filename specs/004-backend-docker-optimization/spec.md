# Feature Specification: Backend Docker Memory Optimization

**Feature ID**: `004-backend-docker-optimization`
**Created**: 2026-07-13
**Status**: Draft
**Input**: The backend Docker container consumes approximately 2GB of RAM at runtime. Investigation revealed four compounding causes: a monolithic dependency (`googleapis`) bundling 322+ unused API clients, the TypeScript compiler (`ts-node`) running in-memory at runtime, all development dependencies installed in the container, and no multi-stage Docker build. The optimization should reduce memory usage to under 800MB without changing application behavior.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Leaner Production Container (Priority: P0)

A developer builds and runs the backend Docker container. The container starts quickly, uses significantly less memory (~500-800MB instead of ~2GB), and serves all API endpoints identically to the current version.

**Why this priority**: The 2GB footprint is the core problem this feature addresses. A production-grade container must not run development tools at runtime.

**Independent Test**: Build the production Docker image, start it via `docker-compose`, and verify all API endpoints respond correctly. Measure memory with `docker stats` and confirm it is under 800MB at idle.

**Acceptance Scenarios**:

1. **Given** a freshly built backend Docker image, **When** it starts up, **Then** Prisma migrations run successfully and the Express server begins accepting requests within 30 seconds.
2. **Given** the production container is running at idle, **When** memory is measured via `docker stats`, **Then** resident memory is under 800MB.
3. **Given** the production container, **When** all existing API endpoints are exercised (threads, messages, chat, tools), **Then** every endpoint returns the same results as the current version.
4. **Given** the production container, **When** inspecting the running Node.js process, **Then** neither the TypeScript compiler nor nodemon is loaded in memory.

---

### User Story 2 - Dev Mode Still Works (Priority: P0)

A developer runs `docker-compose up` in development mode. Source code changes are detected automatically and the server restarts, just like the current experience but with faster restarts and lower memory usage.

**Why this priority**: Development experience must not regress. Developers depend on hot-reload for productivity.

**Independent Test**: Start in dev mode, edit a source file, and verify the server restarts automatically within 3 seconds.

**Acceptance Scenarios**:

1. **Given** the developer runs `docker-compose up` (which auto-merges the override file), **When** they edit a `.ts` file in `backend/src/`, **Then** the server restarts automatically within 3 seconds.
2. **Given** dev mode is running, **When** memory is measured, **Then** it is noticeably lower than the current ~2GB (target: under 1GB).
3. **Given** dev mode is running with volume mounts, **When** the developer adds a new file, **Then** it is picked up on the next save without restarting the container.

---

### User Story 3 - Gmail and Calendar Integrations Still Work (Priority: P0)

The Gmail and Calendar features that previously used the monolithic `googleapis` package continue to work identically after switching to the individual `@googleapis/gmail` and `@googleapis/calendar` packages.

**Why this priority**: These are active features used by the Gmail agent and calendar tool. Regression would break core functionality.

**Independent Test**: Run the Gmail OAuth flow, list emails, create a draft, and query the calendar. All operations should succeed with no behavior change.

**Acceptance Scenarios**:

1. **Given** a user with valid Gmail OAuth tokens, **When** they use the `read_emails` tool, **Then** emails are returned with the same fields and format as before.
2. **Given** a user initiates the Gmail OAuth flow, **When** they complete authorization, **Then** tokens are stored and the callback route works correctly.
3. **Given** a user with valid Google Calendar credentials, **When** they use the `google_calendar` tool to list events, **Then** events are returned correctly.
4. **Given** the `@googleapis/gmail` and `@googleapis/calendar` packages, **When** inspecting `node_modules`, **Then** the monolithic `googleapis` directory (194MB) no longer exists.

---

### Edge Cases

- **Prisma migration failure**: If the database is not ready at container startup, the migration retry loop must still work (retry every 3 seconds until success).
- **Path alias resolution**: The `@shared/*` TypeScript path alias must resolve correctly in both dev mode (tsx) and production mode (compiled JS). All `@shared/*` imports are type-only exports that erase at compile time, so no runtime resolution is needed.
- **Prisma client in production**: The generated Prisma client and query engine must be present in the production image even though `prisma` (the CLI) is a devDependency. The CLI is only needed for `prisma migrate deploy` at startup.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The monolithic `googleapis` package MUST be replaced with `@googleapis/gmail` and `@googleapis/calendar` — only the two services actually used.
- **FR-002**: All imports of `google` from `googleapis` MUST be updated to use the individual package equivalents (`gmail` from `@googleapis/gmail`, `calendar` from `@googleapis/calendar`).
- **FR-003**: OAuth2 client creation MUST use `OAuth2Client` from `google-auth-library` directly, replacing any usage of `google.auth.OAuth2` from the monolithic package.
- **FR-004**: The `ts-node` + `nodemon` dev toolchain MUST be replaced with `tsx watch` for the development server script.
- **FR-005**: The Dockerfile MUST use a multi-stage build: a build stage that compiles TypeScript with `tsc`, and a runtime stage that runs only the compiled JavaScript with production dependencies.
- **FR-006**: The production runtime stage MUST install dependencies with `--omit=dev` to exclude all development dependencies (typescript, jest, eslint, ts-node, nodemon, etc.).
- **FR-007**: The production container MUST run `node --max-old-space-size=512 dist/server.js` — not `ts-node` or `tsx`. The 512MB V8 heap cap prevents silent memory regression.
- **FR-008**: `docker-compose.yml` MUST be split into a production base file and a `docker-compose.override.yml` for development overrides (volume mounts, dev command, NODE_ENV=development).
- **FR-009**: The Prisma CLI MUST remain available in the production container for `prisma migrate deploy` at startup. It should be copied from the build stage rather than installed as a production dependency.
- **FR-010**: All existing API endpoints, tool calls, and SSE streaming MUST continue to work identically after the changes.
- **FR-011**: The backend service MUST expose a `GET /health` endpoint returning HTTP 200, and the production `docker-compose.yml` MUST include a health check that polls this endpoint.
- **FR-012**: The `mathjs` dependency and the `calculator` tool MUST be removed entirely from both backend and frontend. Remove `backend/src/tools/calculator.ts`, its registration in `backend/src/tools/index.ts`, and any calculator-related UI components or references in the frontend (`app/`).

### Non-Functional Requirements

- **NFR-001**: Production container memory usage MUST be under 800MB at idle (measured via `docker stats`).
- **NFR-002**: Dev mode server restart on file change MUST complete within 3 seconds.
- **NFR-003**: Production Docker image size SHOULD be under 500MB (currently estimated at ~800MB+).
- **NFR-004**: Container startup time (from `docker-compose up` to accepting requests) MUST remain under 30 seconds.

### Key Entities

- **Dockerfile (multi-stage)**: Builder stage compiles TypeScript; runtime stage runs compiled JavaScript with production-only dependencies.
- **docker-compose.yml**: Production base configuration without volume mounts or dev tooling.
- **docker-compose.override.yml**: Development overrides auto-merged by Docker Compose for local development.

### Files to Modify

| File | Change |
|------|--------|
| `backend/package.json` | Remove `googleapis`, add `@googleapis/gmail` + `@googleapis/calendar`, add `tsx` to devDeps, remove `nodemon`, update `dev` script |
| `backend/src/services/emailService.ts` | Update imports from `googleapis` to `@googleapis/gmail` |
| `backend/src/tools/googleCalendar.ts` | Update imports from `googleapis` to `@googleapis/calendar` + `google-auth-library` |
| `backend/src/routes/gmailAuthRoutes.ts` | Replace dynamic `googleapis` import with static `@googleapis/gmail` import |
| `backend/Dockerfile` | Rewrite as multi-stage build |
| `docker-compose.yml` | Convert to production base config |
| `docker-compose.override.yml` | New file for dev overrides |
| `backend/src/server.ts` | Add `GET /health` endpoint |
| `backend/src/tools/calculator.ts` | Delete file (remove calculator tool) |
| `backend/src/tools/index.ts` | Remove calculator registration |
| `backend/package.json` | Also remove `mathjs` from dependencies |
| `app/src/components/ChatInput/ChatInput.tsx` | Remove calculator from tool list (line 14) |
| `app/src/components/ChatContainer/ChatContainer.tsx` | Remove calculator from default selected tools (line 26) |

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Production container idle memory is under 800MB (down from ~2GB), verified via `docker stats`.
- **SC-002**: The `googleapis` directory no longer exists in `node_modules` — replaced by `@googleapis/gmail` (~2MB) and `@googleapis/calendar` (~2MB).
- **SC-003**: The production container does not have `typescript`, `jest`, `eslint`, `nodemon`, or `ts-node` in its `node_modules`.
- **SC-004**: All existing tests pass (`npm test`).
- **SC-005**: Gmail OAuth, email tools, and calendar tool work identically to the current version.
- **SC-006**: Dev mode (`docker-compose up`) provides hot-reload with file change detection.
- **SC-007**: Production image size is under 500MB.

## Clarifications

### Session 2026-07-13

- Q: How should legacy JS files outside `src/` (controllers/, routes/, services/) be handled in the production build? → A: They are no longer used. All routes live in `src/` now — legacy files can be ignored.
- Q: Should the production container enforce a Node.js heap memory limit? → A: Yes, set `--max-old-space-size=512` in the production CMD (512MB V8 heap, ~700-800MB total RSS) to prevent silent regression.
- Q: Should the production backend service include a Docker health check? → A: Yes, add an HTTP health check hitting a lightweight endpoint (e.g., `GET /health` returning 200).
- Q: Should `mathjs` optimization be explicitly documented as out-of-scope? → A: Remove `mathjs` entirely along with the `calculator` tool (both backend and frontend). The tool is no longer needed.

## Assumptions

- The `@googleapis/gmail` and `@googleapis/calendar` packages expose the same API surface as accessing `google.gmail()` and `google.calendar()` from the monolithic `googleapis` package — they are generated from the same Google Discovery documents.
- All `@shared/*` imports in the backend are type-only (`export type`) and erase at compile time, so no runtime path alias resolution (e.g., `tsc-alias`) is needed for the production build.
- The existing `tsconfig.json` with `outDir: "./dist"` and `"build": "tsc"` script produces a working compiled output without additional configuration.
- `tsx watch` is a drop-in replacement for `nodemon --exec ts-node` with equivalent file-watching behavior and better performance.
- The `prisma migrate deploy` command can run using the Prisma CLI binary copied from the builder stage without requiring the full `prisma` npm package in production dependencies.
- Legacy JavaScript files in `controllers/`, `routes/`, `services/` (outside `src/`) are no longer used at runtime. All active routes and services live in `src/`. These files do not need to be included in the production build.
