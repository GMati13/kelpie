---
name: acme-review-request
description: How we ask for reviews on acme-web pull requests.
---

# Asking for a review on acme-web

1. Pick a reviewer: whoever is on review duty this week (see REVIEWERS.md).
2. Add them with `gh pr edit <n> --add-reviewer <login>`.
3. Post "Review please: <link>" to the team's review channel with `./scripts/notify.sh "<message>"`.
