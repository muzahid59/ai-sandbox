# Implementation Plan: Convert JavaScript to TypeScript

**Branch**: `001-convert-js-to-ts` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/001-convert-js-to-ts/spec.md`

## Summary

Convert all remaining JavaScript/JSX files to TypeScript/TSX across the
monorepo. The frontend (12 files, ~1,115 LOC) has zero TypeScript setup
and is the primary scope. The backend has 2 remaining JS files. A new
`shared/types/` directory will hold cross-boundary type definitions
consumed by both projects via tsconfig path aliases.

## Technical Context

**Language/Version**: TypeScript 5.x (backend already on ^5.9.3), React 18.2, Node.js
**Primary Dependencies**: react-scripts 5.0.1 (built-in TS support), ts-jest, @types/react, @types/react-dom
**Storage**: PostgreSQL via Prisma (no changes needed)
**Testing**: Jest + @testing-library/react (frontend), Jest + ts-jest + supertest (backend)
**Target Platform**: Web browser (frontend), Node.js server (backend)
**Project Type**: Web application (monorepo: `app/` + `backend/`)
**Performance Goals**: Bundle size increase <5% (SC-007), LCP <2s (constitution)
**Constraints**: No ejection from react-scripts; `strict: true` from day one
**Scale/Scope**: ~1,115 LOC frontend + 2 backend JS files + shared types directory

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality (NON-NEGOTIABLE) | PASS | Feature directly advances TS-only mandate. Linting config must be updated for TS. No dead code introduced. |
| II. Testing Standards | PASS | SC-003 requires all existing tests pass. No new logic — no new tests required beyond file extension changes. |
| III. UX Consistency | PASS | No UI changes. CSS Modules pattern preserved. Prop-drilling pattern maintained. |
| IV. Performance Requirements | PASS | SC-007 constrains bundle size increase to <5%. TypeScript compilation produces identical JS output. |

**Quality Gates:**

| Gate | Status | Action Required |
|------|--------|-----------------|
| Lint Gate | REQUIRES UPDATE | ESLint config must be updated for `@typescript-eslint` parser |
| Type Gate | REQUIRES UPDATE | Frontend needs `tsconfig.json`; backend needs `strict: true` |
| Test Gate | PASS | Tests must continue passing after conversion |
| Coverage Gate | N/A | No new business logic |
| Performance Gate | MONITOR | Verify bundle size delta post-conversion |
| Security Gate | PASS | No new endpoints or user input handling |

No constitution violations. All gates pass or require expected configuration updates.

## Project Structure

### Documentation (this feature)

```text
specs/001-convert-js-to-ts/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (N/A — no new APIs)
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
shared/
└── types/
    ├── thread.ts          # Thread entity types
    ├── message.ts         # Message entity types
    ├── events.ts          # SSE streaming event types
    └── index.ts           # Re-exports

backend/
├── tsconfig.json          # Update: strict: true, add shared/types path alias
├── jest.config.ts         # Converted from .js
├── scripts/
│   └── google-auth.ts     # Converted from .js
└── src/
    └── types/             # Existing — will import from shared/types/ or re-export

app/
├── tsconfig.json          # NEW: strict: true, path aliases for shared types
├── src/
│   ├── types/
│   │   ├── css.d.ts       # CSS Module wildcard declaration
│   │   ├── speech.d.ts    # Web Speech API type augmentation
│   │   └── index.ts       # Frontend-specific types (component props, UI state)
│   ├── App.tsx            # Converted from .js
│   ├── App.test.tsx       # Converted from .js
│   ├── api.ts             # Converted from .js
│   ├── fetch_message.ts   # Converted from .js
│   ├── index.tsx          # Converted from .js
│   ├── reportWebVitals.ts # Converted from .js
│   ├── setupTests.ts      # Converted from .js
│   └── components/
│       ├── ChatContainer/
│       │   └── ChatContainer.tsx    # Converted from .js
│       ├── ChatInput/
│       │   └── ChatInput.tsx        # Converted from .jsx
│       ├── MessageBubble/
│       │   └── MessageBubble.tsx    # Converted from .jsx
│       ├── MessageList/
│       │   └── MessageList.tsx      # Converted from .jsx
│       └── Sidebar/
│           └── Sidebar.tsx          # Converted from .jsx
└── .eslintrc.js           # Updated for @typescript-eslint
```

**Structure Decision**: Existing monorepo structure (`app/` + `backend/`)
preserved. New `shared/types/` directory at repo root for cross-boundary
types. Both tsconfigs reference `shared/types/` via `paths` aliases.

## Complexity Tracking

No constitution violations to justify.
