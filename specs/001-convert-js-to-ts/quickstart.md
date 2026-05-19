# Quickstart: Convert JavaScript to TypeScript

**Date**: 2026-05-19
**Feature**: [spec.md](./spec.md) | [plan.md](./plan.md)

## Prerequisites

- Node.js 18+ installed
- PostgreSQL running (via Docker: `docker-compose up postgres`)
- Repository cloned and on `001-convert-js-to-ts` branch

## Verify Pre-Migration Baseline

Before starting any conversion, verify the current state compiles
and tests pass:

```bash
# Backend baseline
cd backend
npm install
npm run build
npm test

# Frontend baseline
cd ../app
npm install
npm run build
npm test
```

Record the frontend bundle size from `npm run build` output for
SC-007 comparison.

## Step 1: Create Shared Types Directory

```bash
mkdir -p shared/types
```

Create `shared/types/index.ts` exporting Thread, Message, and SSE
event types as defined in `data-model.md`.

## Step 2: Setup Frontend TypeScript

```bash
cd app
npm install --save-dev typescript @types/react @types/react-dom @types/node @types/jest
```

Create `app/tsconfig.json` with `strict: true` and path aliases
for `@shared/types`.

Create type declaration files:
- `app/src/types/css.d.ts` — CSS Module wildcard
- `app/src/types/speech.d.ts` — Web Speech API augmentation

## Step 3: Convert Frontend Files

Rename files one at a time (or all at once for small codebases):

```bash
# Utility files
mv src/index.js src/index.tsx
mv src/App.js src/App.tsx
mv src/App.test.js src/App.test.tsx
mv src/api.js src/api.ts
mv src/fetch_message.js src/fetch_message.ts
mv src/reportWebVitals.js src/reportWebVitals.ts
mv src/setupTests.js src/setupTests.ts

# Components
mv src/components/ChatContainer/ChatContainer.js src/components/ChatContainer/ChatContainer.tsx
mv src/components/ChatInput/ChatInput.jsx src/components/ChatInput/ChatInput.tsx
mv src/components/MessageBubble/MessageBubble.jsx src/components/MessageBubble/MessageBubble.tsx
mv src/components/MessageList/MessageList.jsx src/components/MessageList/MessageList.tsx
mv src/components/Sidebar/Sidebar.jsx src/components/Sidebar/Sidebar.tsx
```

Add type annotations to each file: prop interfaces, function
return types, state types, event handler types.

## Step 4: Update Frontend ESLint

Update `.eslintrc.js` to use `@typescript-eslint/parser` and
add `@typescript-eslint/eslint-plugin`.

## Step 5: Convert Backend JS Files

```bash
cd backend
mv jest.config.js jest.config.ts
mv scripts/google-auth.js scripts/google-auth.ts
```

Update `backend/tsconfig.json`:
- Set `strict: true`
- Add path alias for `@shared/types`
- Fix any strict-mode errors surfaced in existing TS files

## Step 6: Verify Post-Migration

```bash
# Backend
cd backend
npm run build        # Must compile with zero errors
npm test             # All tests must pass

# Frontend
cd ../app
npm run build        # Must compile with zero errors
npm test             # All tests must pass
```

Compare frontend bundle size to baseline. Must be within 5%.

## Step 7: Validate Shared Types

Intentionally introduce a type error (e.g., misspell a Thread
field in `shared/types/thread.ts`). Verify that both `app/` and
`backend/` builds fail with a clear type error.

## Troubleshooting

**CRA doesn't pick up tsconfig.json**: Restart the dev server.
react-scripts reads tsconfig on startup.

**CSS Module imports show errors**: Verify `css.d.ts` exists at
`app/src/types/css.d.ts` with the wildcard module declaration.

**Speech Recognition type errors**: Verify `speech.d.ts` exists
and is included in the tsconfig `include` glob.

**Backend strict mode errors**: Fix one file at a time. Common
issues: implicit `any` in function parameters, possible `null`
in optional chains.
