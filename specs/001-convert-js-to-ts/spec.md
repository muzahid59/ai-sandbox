# Feature Specification: Convert JavaScript to TypeScript

**Feature Branch**: `001-convert-js-to-ts`
**Created**: 2026-05-19
**Status**: Draft
**Input**: User description: "want to convert the rest js code in repo into typescript"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Frontend TypeScript Migration (Priority: P1)

As a developer working on the AI Sandbox frontend, I want all React
components and utility modules converted from JavaScript/JSX to
TypeScript/TSX so that I catch type errors at compile time instead
of discovering them at runtime.

**Why this priority**: The frontend has 12 JS/JSX files totaling
~1,072 lines with zero type safety. This is the largest untyped
surface in the codebase and the area most likely to introduce
regressions during feature development.

**Independent Test**: After conversion, `npm run build` in `app/`
completes with zero TypeScript errors, the dev server starts
successfully, and all existing functionality (chat, sidebar,
streaming) works identically to the pre-conversion baseline.

**Acceptance Scenarios**:

1. **Given** the frontend project has TypeScript configured,
   **When** I run `npm run build`,
   **Then** all `.ts` and `.tsx` files compile without errors.

2. **Given** all React components are converted to TSX with typed props,
   **When** I pass an incorrect prop type to a component,
   **Then** the TypeScript compiler reports an error before runtime.

3. **Given** the API client (`api.js`) is converted to TypeScript,
   **When** I call an API function with incorrect arguments,
   **Then** the TypeScript compiler catches the type mismatch.

4. **Given** the full conversion is complete,
   **When** I start the development server and use the chat interface,
   **Then** all features (send message, streaming, tool display,
   sidebar navigation, thread management) behave identically to
   the JavaScript version.

---

### User Story 2 - Backend JavaScript Cleanup (Priority: P2)

As a developer, I want the remaining backend JavaScript files
converted to TypeScript so that the entire backend is consistently
typed and the `allowJs` flag can be removed from `tsconfig.json`.

**Why this priority**: Only 2 JS files remain in the backend
(`jest.config.js` and `scripts/google-auth.js`). This is a small
effort that completes the backend migration already in progress.

**Independent Test**: After conversion, `npm run build` in
`backend/` compiles successfully, `npm test` passes, and the
`allowJs` tsconfig option can be set to `false` without errors.

**Acceptance Scenarios**:

1. **Given** `jest.config.js` is converted to `jest.config.ts`,
   **When** I run `npm test` in the backend,
   **Then** all existing tests pass with the new configuration.

2. **Given** `scripts/google-auth.js` is converted to TypeScript,
   **When** I run the authentication script,
   **Then** it behaves identically to the JavaScript version.

3. **Given** all backend JS files are converted,
   **When** I set `allowJs: false` in `backend/tsconfig.json`,
   **Then** the project compiles without errors.

---

### User Story 3 - Shared Type Definitions (Priority: P3)

As a developer, I want shared type definitions for data structures
that cross the frontend-backend boundary (threads, messages, SSE
events) so that API contract changes are caught at compile time
on both sides.

**Why this priority**: Once both frontend and backend are in
TypeScript, shared types prevent drift between the API contract
and the frontend's assumptions about response shapes.

**Independent Test**: After creating shared types, changing a
message field name in the backend type definition causes a
compile error in the frontend, proving the types are linked.

**Acceptance Scenarios**:

1. **Given** shared type definitions exist for Thread and Message,
   **When** the backend changes a field name in the Thread type,
   **Then** the frontend build fails with a clear type error
   pointing to the outdated reference.

2. **Given** SSE event types are defined in a shared location,
   **When** a new event type is added to the backend,
   **Then** the frontend can import and handle it with full
   type safety.

---

### Edge Cases

- What happens when a JS file uses dynamic patterns that resist
  static typing (e.g., computed property access, untyped third-party
  libraries)?
- How does the build handle CSS Module type declarations for
  `.module.css` imports in TSX files?
- What happens to `PropTypes` declarations after conversion — are
  they removed or kept as runtime validation?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: All `.js` and `.jsx` files in `app/src/` MUST be
  converted to `.ts` and `.tsx` respectively.
- **FR-002**: All React component props MUST be defined using
  TypeScript interfaces or type aliases, replacing PropTypes.
- **FR-003**: The frontend MUST have a `tsconfig.json` configured
  with `strict: true` (all strict flags enabled from day one).
- **FR-004**: TypeScript type-checking MUST be integrated into the
  frontend build pipeline (`npm run build` and `npm start`).
- **FR-005**: All API client functions in `api.js` MUST have typed
  parameters and return types.
- **FR-006**: SSE event handlers MUST use typed event discriminators
  matching the backend's event format.
- **FR-007**: CSS Module imports MUST have type declarations so
  `.module.css` imports are recognized by TypeScript.
- **FR-008**: The remaining backend JS files (`jest.config.js`,
  `scripts/google-auth.js`) MUST be converted to TypeScript.
- **FR-009**: Runtime PropTypes MUST be removed from all converted
  components to avoid redundancy with compile-time type checking.
- **FR-010**: Shared type definitions for Thread, Message, and SSE
  events MUST be consumable by both frontend and backend.

### Key Entities *(include if feature involves data)*

- **Thread**: Represents a chat conversation (id, title, status,
  model, timestamps). Crosses the API boundary.
- **Message**: Represents a single message in a thread (id, role,
  content blocks as JSONB, tool calls). Crosses the API boundary.
- **SSE Event**: Streaming event types (message_created, delta,
  tool_use_start, tool_use_result, done, error). Defined by
  backend, consumed by frontend.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero JavaScript or JSX files remain in `app/src/`
  after conversion.
- **SC-002**: The frontend build (`npm run build`) completes with
  zero type errors.
- **SC-003**: All existing frontend tests pass without modification
  to test logic (only file extensions and imports change).
- **SC-004**: The backend build (`npm run build`) completes with
  `allowJs: false` and zero errors.
- **SC-005**: A developer introducing a type-incorrect prop to any
  component receives a compile-time error within their editor.
- **SC-006**: All user-facing features (chat, streaming, sidebar,
  tool display) function identically to the pre-conversion
  baseline when tested manually.
- **SC-007**: No increase in frontend bundle size beyond 5% compared
  to the pre-conversion build.

## Clarifications

### Session 2026-05-19

- Q: Where should shared type definitions live and how should both projects consume them? → A: Root-level `shared/types/` directory with tsconfig path aliases configured in both frontend and backend projects.
- Q: Should the frontend TypeScript config use full strict mode from day one or gradual strictness? → A: Full `strict: true` from day one — the codebase is small enough (~1,072 lines) to invest the effort upfront.

## Assumptions

- The existing `react-scripts` (v5.0.1) supports TypeScript out of
  the box via `react-scripts` built-in TypeScript support — no
  ejection or migration to Vite/Webpack is required.
- Third-party libraries used in the frontend have `@types/*`
  packages available or ship their own type definitions.
- PropTypes are the only runtime type-checking mechanism in use and
  can be fully replaced by TypeScript's compile-time checking.
- The shared types will live in a root-level `shared/types/`
  directory. Both `app/tsconfig.json` and `backend/tsconfig.json`
  will configure path aliases to import from this location.
- CSS Modules type declarations will use a wildcard module
  declaration (`*.module.css`) rather than generated per-file
  `.d.ts` files, keeping the setup simple.
- `jest.config.js` in the backend can be converted to
  `jest.config.ts` since ts-jest is already configured.
