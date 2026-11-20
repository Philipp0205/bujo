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

## Scope

- Build every item the task lists. If you can't finish one, say so by name in your final message under "Not done", with the reason. Never drop a listed item silently.
- Don't change contracts the task didn't ask about: route paths, API shapes, `package.json` engines, dependencies, or config. If one has to change for a listed item to work, say what and why in one line.
- If you spot a useful extra, don't build it. List it under "Not done (ideas)", one line each.

## OpenCode

Use OpenCode with the litellm provider.

## Style

- Never use em dashes in code comments, copy, commits, or PR text.
- No secrets, tokens, or real page photos in output, screenshots, commits, or PR text.

## Code rules

- Keep functions short. No giant render, boot, or refresh functions; split them.
- Put a one-line comment on each key function: what it does and why.
- Group code into domain folders (`log/`, `scan/`, `sync/`, `auth/`), not one flat folder.
- Keep UI copy and strings out of logic files. Put them in a strings/copy module.
- Keep application logic separate from UI code.
- Delete unused folders and files. No dead code.
- Vendored app-kit dirs (`public/app-kit`, `src/app-kit`) are exempt. Never edit them.

## Real data

Never point tests or agent runs at the live Aufgaben or Arbeit lists. Never delete CalDAV collections. Never delete items without an explicit yes from Philipp.
