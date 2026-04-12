---
name: commit
description: Stage changes and create a commit with an auto-generated message
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(npx eslint *) Bash(npx prettier *) Bash(npx tsc *) Bash(cd *)
---

# Commit changes

1. Check the current branch with `git branch --show-current`
   - **NEVER commit directly to `main` or `master`**
   - If on `main`/`master`, create a new branch first: `git checkout -b <descriptive-branch-name>`
   - Use branch names like `feat/tool-calling`, `fix/login-bug`, `refactor/auth-middleware`
2. Run `git status` and `git diff` to understand what changed
3. Stage relevant files — avoid secrets (.env, credentials) and large binaries
4. Generate a concise commit message:
   - Start with a verb (Fix, Add, Update, Refactor, Remove)
   - First line under 50 characters
   - Add body with details if the change is non-trivial
5. Commit the changes
6. If the pre-commit hook fails:
   - Read the error output to identify which check failed (lint or type check)
   - For frontend lint errors: run `cd app && npx eslint --fix <files>` to auto-fix
   - For frontend format errors: run `cd app && npx prettier --write <files>` to auto-fix
   - For backend type errors: read the error, fix the code manually
   - Re-stage the fixed files with `git add`
   - Retry the commit (do NOT use --no-verify)
7. Show the final commit with `git log -1` and display the full commit message to the user
