# Project git hooks

Hooks committed to the repo that any contributor can opt into with one
command:

```bash
git config core.hooksPath .githooks
```

Run that once after cloning. Subsequent commits then go through the
hooks listed below. (The repo doesn't ship Husky on purpose — adding a
JS dependency to gate a shell script is overkill.)

## Hooks

| Hook | Purpose |
|---|---|
| `pre-commit` | Scans the staged diff for secret-shaped content (Supabase JWTs, Anthropic keys, Google OAuth secrets, AWS keys, password-bearing Postgres URIs, bearer tokens) and refuses the commit if anything matches. False positives can be bypassed with `git commit --no-verify` after eyeballing the hunk — don't make that bypass routine. |

## On Windows

The pre-commit hook is a Bash script. It runs out of the box under Git
for Windows (Git Bash) and on macOS / Linux. If you're on a Windows
shell that doesn't ship bash, install Git for Windows or run commits
through WSL.
