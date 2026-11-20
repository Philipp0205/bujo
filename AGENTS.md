# bujo

Hybrid paper + digital bullet journal.

## Workflow

- One branch per change, cut from current `origin/main`. Name it for the work (`docs/brief`, `feat/...`, `fix/...`).
- Never push to `main` after the initial scaffold. Never merge. Leave the PR unmerged until Philipp says yes.
- Never commit secrets, `.env` files, or real journal page photos.
- Tests never touch real Nextcloud lists. Use a separate test list or fixtures only.

## Gates

Before reporting a change done, run `scripts/check.sh` from the repo root. It must pass. It runs `npm ci`, `npm run typecheck`, `npm test`, and `npm run test:ui`, and stops at the first failure.

Until `package.json` exists, those steps are placeholders and the script reports an ok line for each.

## OpenCode

Use OpenCode with the litellm provider.

## Style

- Never use em dashes in code comments, copy, commits, or PR text.
- No secrets, tokens, or real page photos in output, screenshots, commits, or PR text.

## Real data

Never point tests or agent runs at the live Aufgaben or Arbeit lists. Never delete CalDAV collections. Never delete items without an explicit yes from Philipp.
