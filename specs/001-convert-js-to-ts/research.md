# Research: Convert JavaScript to TypeScript

**Date**: 2026-05-19
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

## R1: react-scripts TypeScript Support

**Decision**: Use react-scripts built-in TypeScript support (no ejection).

**Rationale**: react-scripts 5.x detects TypeScript automatically when
`tsconfig.json` exists and `.tsx` files are present. It ships with
`ts-loader` and handles compilation without additional configuration.
Adding `typescript` as a devDependency and creating `tsconfig.json` is
sufficient — CRA auto-generates sensible defaults on first build if
the tsconfig is minimal.

**Alternatives considered**:
- Eject from CRA: Full control but adds ~30 config files to maintain.
  Rejected — overkill for a type migration.
- Migrate to Vite: Better DX long-term but out of scope for this
  feature. Can be a separate initiative.

## R2: TypeScript Strict Mode on Existing Codebase

**Decision**: Enable `strict: true` from day one in the frontend
tsconfig. Enable `strict: true` in the backend tsconfig (currently
`false`).

**Rationale**: The frontend codebase is ~1,115 LOC — small enough to
fix all strict-mode issues during conversion. The backend already has
well-typed code; enabling strict will surface a bounded set of issues
in existing TS files that should be fixed.

**Alternatives considered**:
- Gradual strictness: Start with `strict: false` and enable flags one
  by one. Rejected — creates ongoing migration overhead for a small
  codebase. Clarification Q2 confirmed full strict from day one.

## R3: Shared Types Architecture

**Decision**: Root-level `shared/types/` directory with tsconfig path
aliases in both projects.

**Rationale**: Both projects need the same Thread, Message, and SSE
event type definitions. A root-level directory avoids publishing a
package and keeps the monorepo simple. Path aliases
(`@shared/types/*`) provide clean import paths.

**Alternatives considered**:
- Frontend imports from `backend/src/types/` directly: Creates a
  compile-time dependency from frontend to backend source tree.
  Rejected — tight coupling.
- Duplicate types in both projects: Zero coupling but drift risk.
  Rejected — defeats the purpose of shared types.
- Workspace package (`packages/shared-types/`): Requires npm/yarn
  workspace setup. Rejected — over-engineering for 4 type files.

## R4: CSS Module Type Declarations

**Decision**: Wildcard module declaration (`*.module.css`) in a
`css.d.ts` file.

**Rationale**: CSS Modules in CRA produce runtime objects where keys
are class names. A wildcard declaration
(`declare module '*.module.css'`) satisfies the compiler. Per-file
generated `.d.ts` files (via `typescript-plugin-css-modules`) provide
autocomplete but add build complexity — not worth it for this
codebase size.

**Alternatives considered**:
- `typescript-plugin-css-modules`: Generates per-file declarations
  with class name autocomplete. Rejected — adds a plugin dependency
  and build step for marginal benefit on 5 CSS Module files.
- `typed-css-modules` CLI: Generates `.d.ts` files from CSS. Same
  concern — unnecessary complexity.

## R5: Web Speech Recognition API Types

**Decision**: Custom type declaration file (`speech.d.ts`) augmenting
the global `Window` interface.

**Rationale**: `ChatContainer.js` uses `window.SpeechRecognition` and
`window.webkitSpeechRecognition`. The Web Speech API is not fully
standardized and TypeScript's default DOM types only include a partial
definition. A custom `.d.ts` file will declare the vendor-prefixed
interfaces to satisfy strict mode.

**Alternatives considered**:
- `@types/web-speech-api` package: Exists but may conflict with
  built-in DOM types in newer TS versions. Rejected — a small custom
  declaration is safer and more maintainable.
- Cast to `any`: Bypasses type safety. Rejected — violates strict
  mode and constitution Principle I.

## R6: ESLint TypeScript Configuration

**Decision**: Update `.eslintrc.js` to use `@typescript-eslint/parser`
and `@typescript-eslint/eslint-plugin`.

**Rationale**: The current ESLint config targets JS/JSX only. TypeScript
files need the TS parser for proper AST handling. The
`@typescript-eslint` plugin provides TS-aware rules that replace
standard ESLint rules (e.g., `no-unused-vars` →
`@typescript-eslint/no-unused-vars`).

**Alternatives considered**:
- Keep ESLint for JS only, rely on `tsc` for TS errors: Misses
  style/convention rules. Rejected.
- Migrate to Biome/oxlint: Out of scope for this feature.

## R7: PropTypes Removal

**Decision**: Remove all PropTypes imports and declarations. No
PropTypes are currently in use.

**Rationale**: Research confirms that `react/prop-types` ESLint rule
is already set to `'off'` and zero files import from `prop-types`.
No removal work needed — the codebase never adopted PropTypes.

## R8: Backend `strict: true` Impact

**Decision**: Enable `strict: true` in `backend/tsconfig.json`
alongside the JS file conversion.

**Rationale**: The backend is already fully TypeScript except for 2
files. Enabling strict mode will surface any implicit `any` types
in existing code. Since the backend uses well-structured types in
`src/types/`, the strict-mode surface area is bounded. Fixing these
issues during the migration avoids a separate strictness pass later.

**Alternatives considered**:
- Keep backend at `strict: false`: Leaves type holes in production
  code. Rejected — violates constitution Principle I.
