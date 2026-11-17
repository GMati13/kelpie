---
name: acme-ci-fix
description: How we fix failing CI on acme-web pull requests.
---

# Fixing CI on acme-web

1. Reproduce locally with `npm test`.
2. Fix the cause in the code, never by loosening a test.
3. Commit as `fix(ci): <what>` and push to the pull request's branch.
