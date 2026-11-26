# bujo

Hybrid paper + digital bullet journal.

## Workflow

- One branch per change, cut from current `origin/main`. Name it for the work (`docs/brief`, `feat/...`, `fix/...`).
- Never push to `main` after the initial scaffold. Never merge. Leave the PR unmerged until Philipp says yes.
- Never commit secrets, `.env` files, or real journal page photos.
- Tests never touch real Nextcloud lists. Use a separate test list or fixtures only.

## Gates

Before reporting a change done, run `scripts/check.sh` from the repo root. It must pass. It runs `npm ci`, `npm run typecheck`, `npm test`, and `npm run test:ui`, and stops at the first failure.
If the full run is red only on UI specs that your change doesn't touch and that pass when rerun alone (`npx playwright test test/ui/<name>.spec.ts`), report each one as a flake by name and stop. Start another full `scripts/check.sh` only after you changed code to fix a real failure.

Until `package.json` exists, those steps are placeholders and the script reports an ok line for each.

- If you changed what a screen looks like, take a Playwright screenshot of each changed screen at a 390x844 phone viewport (fake data only) into `/tmp/opencode/shots/<branch-name>/`, and list the paths in your final message. Don't commit them. Before each shot, dismiss the app-kit install banner and wait until toasts are gone. Use deviceScaleFactor 3, empty the shots folder first, and seed fresh fake data for the shots instead of reusing what earlier tests left behind. After shooting, check with `sha1sum` that no two shots are identical. Write the shot script as `test/ui/<name>.shot.ts` (gitignored, reuses `test/ui/harness.ts`) and run it with `npx playwright test -c playwright.shots.config.ts`. Don't build a Playwright setup, `package.json` or `node_modules` link under `/tmp`. Before each shot, scroll the changed element to the middle of the screen with `locator.evaluate(el => el.scrollIntoView({ block: "center" }))` (`scrollIntoViewIfNeeded()` ignores the fixed tab bar and dock, so the element can end up under them), and give light and dark shots of the same screen the same scroll position.
- Open each PNG with the read tool and check it against the task's mock if there is one: alignment and centring, paper colors (no leftover app-kit accent in focus rings, links, banners), nothing cut off or covered. For any scrollable list or sheet, also shoot it scrolled to the bottom (and expanded, if it can expand) and check that the last row sits fully above any fixed dock, bar or button. Fix and retake before reporting done.

## Shipping a user-visible change

When a change alters what a user sees in the app:

- Bump `version` by one in `public/sw.js`, inside `AppKitSW.setup`. The file already says to bump it whenever a file in `shell` changes.
- Add a what's-new entry at the top of `public/whats-new.json` (newest first). Each entry is an object with `id`, `date`, `title`, `bullets`. The id is `YYYY-MM-DD-<slug>`, for example `2026-11-23-fonts`. Title and bullets are one-line user copy matching the existing entries (recent ones are short English sentences). To insert it, edit with the current first entry's opening as `oldString` (`[`, `{` and its `"id"` line); a bare `[` or `[\n` matches more than once and the edit fails.
- Take the shots from the screenshot rule in Gates, and run `scripts/check.sh`.
- Skip all of this (version bump, entry, fixture ids, shots) for docs-only or test-only changes that do not change what a user sees.

## How the bujo bot works

The outer loop, for any agent or human:

- One git worktree per change, cut from current `origin/main`.
- One OpenCode run does the whole loop: implement, then run `scripts/check.sh` and fix until it passes. Use the global default model, no `-m`.
- After that run, the bot reads the diff and runs `scripts/check.sh` itself. Green is the proof.
- Then it opens a PR with phone screenshots of the changed screens. Docs-only or test-only PRs need no screenshots.
- Philipp picks merge, change, or hold. Squash merge only on his go and only with green checks. Never push to `main` after the initial commit.
- After a merge, the bot repins the Railway app service to the merge sha, and repins the ocr service only when `ocr/` changed. Then it smokes `/healthz` and `/sw.js`.
- Tests use the `bujo-test` CalDAV list only, never his real Nextcloud lists.
- Never touch the server, app-kit, Nextcloud config, or other repos directly.
- Never commit secrets or real page photos.

## Scope

- Build every item the task lists. If you can't finish one, say so by name in your final message under "Not done", with the reason. Never drop a listed item silently.
- Don't change contracts the task didn't ask about: route paths, API shapes, `package.json` engines, dependencies, or config. If one has to change for a listed item to work, say what and why in one line.
- If you spot a useful extra, don't build it. List it under "Not done (ideas)", one line each.

## OpenCode

Use OpenCode with the global default model (currently github-copilot/claude-sonnet-5.5); don't pass -m.

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
