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

- If you changed what a screen looks like, take a Playwright screenshot of each changed screen at a 390x844 phone viewport (fake data only) into `/tmp/opencode/shots/<branch-name>/`, and list the paths in your final message. Don't commit them. Before each shot, dismiss the app-kit install banner and wait until toasts are gone. Use deviceScaleFactor 3, empty the shots folder first, and seed fresh fake data for the shots instead of reusing what earlier tests left behind. After shooting, check with `sha1sum` that no two shots are identical.
- Open each PNG with the read tool and check it against the task's mock if there is one: alignment and centring, paper colors (no leftover app-kit accent in focus rings, links, banners), nothing cut off or covered. For any scrollable list or sheet, also shoot it scrolled to the bottom (and expanded, if it can expand) and check that the last row sits fully above any fixed dock, bar or button. Fix and retake before reporting done.

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

## Tools

- View files with the read tool (offset/limit for long files), search with the grep tool, find files with the glob tool, including inside `public/app-kit` and `node_modules`. Do not use `cat`, `sed -n`, `head`, `grep`, `git grep`, `ls` or `wc` in bash to read or search files, not even chained after `cd ...;`. Those are blocked and each try wastes a call. Trimming a command's own output (`npm run test:ui 2>&1 | tail -40`) is fine.
- The grep tool uses ripgrep regex: no lookaround (`(?!...)`, `(?<=...)`). Search for the plain term and filter by reading.
- Create files with the write tool, scratch specs and scripts too (put them in `/tmp/opencode/`). Never `cat > file <<EOF`, `cat >> file` or `sed -i`, also not behind `cd ... &&`.
