---
name: acme-ship
description: How we land and ship acme-web pull requests.
---

# Shipping an acme-web pull request

1. Check the pull request's checks pass and it's approved.
2. Merge it with `gh pr merge <n> --squash --delete-branch`.
3. Deploy with `make deploy`, then check https://acme.example.com loads.
