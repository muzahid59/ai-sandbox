---
name: push
description: Push current branch to remote, setting upstream if needed
disable-model-invocation: true
allowed-tools: Bash(git *)
---

# Push to remote

1. Run `git status` to confirm there are no uncommitted changes that might be left behind
2. Check if the current branch tracks a remote branch:
   - Run `git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null`
   - If no upstream is set, push with `-u origin <branch>` to set tracking
   - If upstream exists, push normally with `git push`
3. Show the result — confirm the push succeeded and display the remote URL
