<!--
  Sync Impact Report
  ===================
  Version change: 0.0.0 (template) → 1.0.0
  Bump rationale: MAJOR — initial constitution ratification with all principles defined.

  Modified principles:
    - [PRINCIPLE_1_NAME] → I. Code Quality (NON-NEGOTIABLE)
    - [PRINCIPLE_2_NAME] → II. Testing Standards
    - [PRINCIPLE_3_NAME] → III. User Experience Consistency
    - [PRINCIPLE_4_NAME] → IV. Performance Requirements
    - [PRINCIPLE_5_NAME] → removed (4 principles per user request)

  Added sections:
    - Quality Gates (Section 2)
    - Development Workflow (Section 3)
    - Governance (filled from template)

  Removed sections:
    - Principle 5 placeholder (reduced from 5 to 4 principles)

  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ no update needed (Constitution Check reads dynamically)
    - .specify/templates/spec-template.md ✅ no update needed (requirements/success criteria are flexible)
    - .specify/templates/tasks-template.md ✅ no update needed (test-first guidance aligns with Principle II)

  Follow-up TODOs: none
-->

# AI Sandbox Constitution

## Core Principles

### I. Code Quality (NON-NEGOTIABLE)

All production code MUST adhere to strict quality standards that
ensure maintainability, readability, and correctness.

- TypeScript MUST be used for all new backend code in `backend/src/`.
  Legacy JavaScript in `backend/controllers/`, `backend/routes/`,
  `backend/services/` is permitted but MUST NOT be extended with new
  modules.
- Every module MUST have a single, clear responsibility. No file may
  combine unrelated concerns (e.g., route handling and business logic).
- Structured logging via pino MUST be used for all runtime diagnostics.
  Raw `console.log` statements are prohibited in committed code.
- Dead code, unused imports, and commented-out code blocks MUST be
  removed before merge. No "just in case" retention.
- Linting (`npm run lint`) and formatting (`npm run format`) MUST pass
  with zero errors and zero warnings before any PR is opened.
- Functions MUST be small and focused. If a function exceeds 50 lines,
  it MUST be decomposed unless decomposition would reduce clarity.

**Rationale**: The hybrid JS/TS codebase demands strict guardrails to
prevent further fragmentation. Consistent quality reduces onboarding
time and bug surface area.

### II. Testing Standards

All features and bug fixes MUST include tests that verify correctness
at the appropriate level of abstraction.

- Unit tests MUST cover all service-layer logic and utility functions.
  Tests reside in `backend/tests/` using Jest + ts-jest.
- Integration tests using supertest MUST cover all API endpoints,
  validating request/response contracts, status codes, and error
  responses.
- Frontend component tests MUST verify user-visible behavior, not
  implementation details. Prefer testing what the user sees and does.
- Test names MUST describe the expected behavior in plain language
  (e.g., "returns 404 when thread does not exist").
- Tests MUST be deterministic: no reliance on timing, external
  services, or shared mutable state between test cases.
- SSE streaming endpoints MUST have dedicated tests that validate the
  full event sequence (message_created → delta → done).
- Minimum coverage threshold: 80% line coverage for new code. Critical
  paths (auth, message handling, tool execution) MUST have 100%
  branch coverage.

**Rationale**: The agentic loop and SSE streaming introduce complex
state transitions. Without rigorous testing, regressions propagate
silently through the tool-calling pipeline.

### III. User Experience Consistency

The frontend MUST deliver a predictable, responsive, and visually
coherent experience across all interaction paths.

- All user-facing state changes MUST provide immediate visual feedback.
  Loading states, error states, and empty states MUST be explicitly
  handled — no blank screens or silent failures.
- Error messages shown to users MUST be actionable and non-technical.
  Internal error codes and stack traces MUST NOT leak to the UI.
- Component styling MUST use CSS Modules exclusively. Global styles
  are prohibited except in `index.css` for resets and CSS variables.
- The chat interface MUST handle streaming responses gracefully:
  partial content MUST render incrementally, and connection failures
  MUST show a retry option.
- Tool execution feedback MUST be visible to the user in real-time:
  tool name, status (running/success/error), and duration.
- Keyboard navigation and screen reader compatibility MUST be
  maintained for all interactive elements.
- All UI components MUST follow the existing prop-drilling pattern
  from `App.js`. State management changes require explicit
  constitution amendment.

**Rationale**: Users interact with AI responses that involve
unpredictable latency and multi-step tool execution. Consistent UX
patterns prevent confusion and build trust in the system.

### IV. Performance Requirements

The system MUST meet defined performance targets under expected load
to ensure a responsive user experience.

- API response time for non-streaming endpoints MUST be under 200ms
  at p95 under normal load (single user, local development).
- SSE streaming MUST deliver the first delta event within 500ms of
  request receipt (excluding upstream AI provider latency).
- Frontend initial page load (LCP) MUST complete within 2 seconds on
  a standard broadband connection.
- The context service in-memory cache MUST enforce its 10-minute TTL
  and MUST NOT exceed 100MB of heap usage under normal operation.
- Database queries MUST use appropriate indexes. Any query exceeding
  100ms MUST be logged as a warning and investigated.
- Tool execution timeout (configured in ToolRegistry) MUST be enforced.
  Runaway tool calls MUST NOT block the agentic loop beyond the
  configured limit.
- Bundle size for the React frontend MUST NOT exceed 500KB gzipped
  for the main chunk. New dependencies MUST justify their size impact.

**Rationale**: The agentic loop introduces multiplicative latency —
each tool call adds a round trip. Strict performance budgets prevent
degradation from compounding across iterations.

## Quality Gates

All code changes MUST pass the following gates before merge:

- **Lint Gate**: `npm run lint` passes with zero errors in both
  `app/` and `backend/`.
- **Type Gate**: `npm run build` in `backend/` compiles with zero
  TypeScript errors.
- **Test Gate**: `npm test` passes in both `app/` and `backend/`
  with all tests green.
- **Coverage Gate**: New code meets the 80% line coverage threshold.
- **Performance Gate**: No new database queries without index coverage.
  No new dependencies exceeding 50KB gzipped without justification.
- **Security Gate**: No hardcoded secrets, no SSRF-vulnerable URL
  handling, no unvalidated user input reaching database queries.
  OWASP Top 10 violations are treated as P0 blockers.

## Development Workflow

All contributors MUST follow this workflow for code changes:

- **Branch Strategy**: Feature branches from `main`. Branch names
  MUST be descriptive (e.g., `feature/add-image-tool`,
  `fix/sse-reconnection`).
- **Commit Discipline**: Each commit MUST represent a single logical
  change. Commit messages MUST follow conventional commits format
  (e.g., `feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
- **PR Requirements**: Every PR MUST include a description of what
  changed, why it changed, and how to test it. PRs touching API
  endpoints MUST update the Postman collection.
- **Review Checklist**: Reviewers MUST verify compliance with all
  four core principles. Constitution violations are blocking.
- **Migration Discipline**: Database schema changes MUST use Prisma
  migrations (`npx prisma migrate dev`). Direct database
  modifications are prohibited.

## Governance

This constitution is the authoritative source of development standards
for the AI Sandbox project. It supersedes informal conventions and
ad-hoc decisions.

- **Amendments**: Any change to this constitution MUST be documented
  with a version bump, rationale, and impact assessment. Principle
  additions or removals require a MAJOR version bump. Clarifications
  require a PATCH bump.
- **Versioning**: This constitution follows semantic versioning
  (MAJOR.MINOR.PATCH). See the Sync Impact Report at the top of this
  file for change history.
- **Compliance**: All PRs and code reviews MUST verify adherence to
  the core principles. Complexity that violates a principle MUST be
  justified in the PR description with a reference to the specific
  principle being exempted.
- **Runtime Guidance**: For day-to-day development guidance, refer to
  `CLAUDE.md` at the repository root. The constitution defines the
  "what" and "why"; `CLAUDE.md` defines the "how".

**Version**: 1.0.0 | **Ratified**: 2026-05-19 | **Last Amended**: 2026-05-19
