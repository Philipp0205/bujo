# bujo

Private hybrid bullet journal: paper day pages, a digital backlog in Nextcloud Tasks (CalDAV VTODO), and an evening scan with a mandatory review before anything syncs.

Built as an app-kit PWA (pinned to v0.7.0), in the same shape as Hangry (free-now). The product brief lives in `docs/brief.md`.

What it does now: a phone-sized backlog of open tasks with filters (all open, by tag, by priority, someday, scheduled), one sign-in, agent tokens, and a JSON API plus an MCP endpoint so an AI agent can read and change tasks. Nothing can be deleted through bujo.

## Run

Needs Node 22.13 or newer (the database is the built-in `node:sqlite`).

    npm ci
    npm start        # http://127.0.0.1:3000, demo data unless CalDAV is configured
    npm run dev      # same, restarts on change

With no CalDAV settings the server shows built-in demo tasks, so the UI works offline. The database file is created on first start (default `data/bujo.db`, ignored by git).

## Sign-in and the one account

bujo has exactly one account. There is no password: you get a recovery code once, at sign-up, and you sign in with it. Save it in a password manager.

- Open `/signup`, enter a name and an email, save the recovery code, and you are in. A second sign-up is refused (a database trigger enforces it).
- The session cookie is `bujo_session` (HttpOnly, SameSite=Lax, 180 days). Sign out from Settings.
- If you lose the code, `/lost` emails a one-time link (20 minutes) to the confirmed address. Using it signs out other devices and issues a new code.
- If the confirm mail did not arrive, Settings shows "Send confirmation link again" while the email is unconfirmed and email is on.
- Risk: the first visitor claims the account. Sign up right after you deploy, before you share the address.
- Email is off unless `RESEND_API_KEY` and `MAIL_FROM` are both set. While it is off, the confirm and lost-code links cannot be sent, so the recovery code is the only way in. Keep it safe.

## Agent access

An agent uses a token from Settings, not your session. A token is shown once. Only its prefix is listed after that. Revoking it takes effect at once.

- `read` tokens may only read. `write` tokens may also create, change and complete tasks.
- A token cannot manage tokens, and cannot use `/api/backlog` or the pages.
- Send it as `Authorization: Bearer bujo_...`. A bad or revoked token is a 401, with no fallback to a cookie.
- There is no delete anywhere: a `DELETE` gets 405.

### REST: `/api/v1`

| Method and path | What |
| --- | --- |
| `GET /api/v1/lists` | The lists and the default one. |
| `GET /api/v1/tags` | Tags with counts. |
| `GET /api/v1/tasks` | Tasks. Query: `list`, `status` (`open` or `all`), `tag`, `priority` (`1`, `5`, `9` or `none`), `someday`, `scheduled` (`true` or `false`). |
| `POST /api/v1/tasks` | Create. Body: `summary` (required), `list`, `description`, `due` (`YYYY-MM-DD`), `priority` (1, 5, 9), `tags`, `someday`. |
| `GET /api/v1/lists/:list/tasks/:uid` | One task. |
| `PATCH /api/v1/lists/:list/tasks/:uid` | Change fields. Fields you leave out stay as they are. `null` clears `due`, `description`, `priority`. |
| `POST /api/v1/lists/:list/tasks/:uid/complete` | Mark done. Doing it again changes nothing. |

Example:

    curl -H "Authorization: Bearer $BUJO_TOKEN" "https://bujo.example.com/api/v1/tasks?tag=Haushalt"
    curl -X POST -H "Authorization: Bearer $BUJO_TOKEN" -H "Content-Type: application/json" \
      -d '{"summary":"Milch kaufen","due":"2026-12-01","tags":["Haushalt"]}' \
      https://bujo.example.com/api/v1/tasks

A change uses the task's ETag, so an edit made elsewhere in between is a 409 and nothing is overwritten.

### MCP: `/mcp`

A small MCP server (JSON-RPC 2.0 over Streamable HTTP, protocol 2025-06-18), written without an SDK. `POST /mcp` only, one message per request, agent tokens only. Tools: `list_tasks`, `get_task`, `list_tags`, `list_lists`, `create_task`, `update_task`, `complete_task`. A read token calling a write tool gets a tool error. A request with a foreign `Origin` header is refused.

A client that takes a URL and headers, for example:

    {
      "mcpServers": {
        "bujo": {
          "type": "http",
          "url": "https://bujo.example.com/mcp",
          "headers": { "Authorization": "Bearer bujo_..." }
        }
      }
    }

### Due dates

Writes go to Nextcloud as VTODO. If a change sets a new `due`, it is written as an all-day date (`VALUE=DATE`), so the old time and time zone are dropped. If `due` is not part of the change, the task's existing `DUE` is kept exactly as it was.

## Environment

Names only; copy `.env.example` and keep real values in your shell or an untracked `.env`, never in the repo.

| Variable | Meaning |
| --- | --- |
| `BUJO_DB` | SQLite file. Default `data/bujo.db`. |
| `BUJO_ORIGIN` | Public address, for example `https://bujo.example.com`. Used for links in mail and the origin check. Default `http://localhost:<port>`. |
| `RESEND_API_KEY`, `MAIL_FROM` | Turn email on. Both or neither. |
| `BUJO_CALDAV_BASE` | Origin of the CalDAV server, for example `https://cloud.example.com`. |
| `BUJO_CALDAV_USER` | Basic auth user. |
| `BUJO_CALDAV_PASSWORD` | Basic auth password (an app password is best). |
| `BUJO_CALDAV_LISTS` | `name=path` pairs, comma separated: `Aufgaben=/remote.php/dav/calendars/admin/tasks/,Arbeit=/remote.php/dav/calendars/admin/arbeit/` |
| `BUJO_SYNC_LIST` | Name (from `BUJO_CALDAV_LISTS`) of the list daily-log tasks are pushed to. Default `bujo-test`. If that name is not in `BUJO_CALDAV_LISTS`, entries show a sync error and nothing is sent. |
| `BUJO_LIVE_SYNC` | `1` lets the sync write to the live task lists `Aufgaben` and `Arbeit`. Anything else keeps them blocked. It never opens a calendar for events. |
| `BUJO_CALDAV_EVENT_CALENDAR` | One `name=path` pair, for example `bujo-test-cal=/remote.php/dav/calendars/admin/bujo-test-cal/`. The calendar daily-log events are pushed to. Not part of `BUJO_CALDAV_LISTS`. Only the calendar named `bujo-test-cal` is ever written; any other name or path is refused. Unset: events show a sync error and nothing is sent. |
| `PORT`, `HOST` | Listen address. Default `3000` and `127.0.0.1`. |
| `BUJO_TRUST_PROXY` | `1` behind a reverse proxy, so rate limits use `X-Forwarded-For`. Leave unset otherwise. |
| `OCR_URL` | Address of the OCR service, for example `http://127.0.0.1:8090`. Unset: the scan answers 503. |
| `OCR_LLM_BASE`, `OCR_LLM_KEY` | Set on the OCR service, not the app. Gateway root (OpenAI-compatible, for example `https://gateway.example/v1`) and its key. Both are required: the LLM is the only reader, and without them every scan fails. |
| `OCR_LLM_MODEL`, `OCR_LLM_TIMEOUT` | Set on the OCR service. Model name (default `claude-haiku-5-5`) and seconds to wait per request (default `25`, inside the app's 60 s scan timeout). |

Set `BUJO_CALDAV_BASE` and `BUJO_CALDAV_LISTS` together, or neither. Behind HTTPS, set `BUJO_ORIGIN` to the `https://` address so the cookie is marked Secure.

Daily-log sync is one way, from bujo to Nextcloud, and only when CalDAV is set up. Tasks, done, moved and scheduled entries become VTODOs in the `BUJO_SYNC_LIST` list. Events become VEVENTs in the `BUJO_CALDAV_EVENT_CALENDAR` calendar: all-day without a time, or one hour from the given time in Europe/Berlin. Notes stay local. It never deletes anything in Nextcloud, and it never touches an event that bujo did not write. A push that fails shows a short reason in the entry sheet with a Retry sync button.

Other endpoints: `GET /healthz`, `GET /api/backlog` (browser session only; `?status=all` adds completed and cancelled), `/api/auth/*` and `/api/tokens` for the pages, static files from `public/`.

## Evening scan

Open `/scan` (the Scan link on the backlog). Take a photo of the day page or pick one, then review one card per line: the symbol it was read as, the text, the matching open task, the list, and a due date for a `<` line. Nothing is written until you press Accept, and only included lines are written.

- `x` marks the matching open task done. `•` and `>` keep a matching task or add a new one. `<` sets a due date. `○`, `–` and lines without a symbol are never synced.
- The page date comes from the first date line on the page, else it is the day you scanned. It is shown, not written.
- The photo is sent once, held in memory while it is read, and never written to disk or kept. A draft (text only) lives in memory for 24 hours, up to 5. A restart drops them.
- A draft can be applied once. If a write fails, the rest are reported as not tried and nothing is retried.
- Agents: `GET /api/scan/:id` works with any token. Upload (`POST /api/scan`) and apply (`POST /api/scan/:id/apply`) need your session.
- HEIC photos are passed on as they are. The OCR service cannot read HEIC yet and answers an error, so use JPEG or PNG for now (iPhone: Settings, Camera, Formats, Most Compatible).

### Scanning a daily-log page

The Scan button in the bottom bar (next to Add) opens the scan screen. Take a photo of the page (or pick one), then review one row per line: type, title, tag, and a keep check. Nothing is written until you press Apply, and only kept rows are written.

- A header date line sets the day (`20.11.2026`, `20.11.`, `Friday 20.11`). With none, the day open in the log is used. You can pick another day in the review.
- Scanning the same page again is a rescan, and the same matcher serves the first scan. Each line is matched 1:1 to an entry of that day (stored scan key, then exact title, then a fuzzy title with a soft type and position hint; two equally good entries bind neither). A line is **new** (no match), **edited** (matched, and type, title, tag or time differ, shown as before and after) or **unchanged** (folded into a count). An entry that no later scan mentions is never flagged or deleted, and an entry you changed in the app since the last scan is not overwritten by an unchanged paper line.
- Lines with no bullet are read as notes and start off. Rows under 80% confidence say "check spelling".
- Endpoints, browser session only (no tokens): `POST /api/log/scan?date=YYYY-MM-DD` (raw image, answers the review, writes nothing), `POST /api/log/scan/:id/check` (rechecks lines against a day: new, edited with before and after, or unchanged; writes nothing), `POST /api/log/scan/:id/apply` (adds the kept new lines, updates the kept edited ones and records unchanged ones, in one transaction, once per draft; never deletes). The OCR service and the 24 hour in-memory drafts are the same as the evening scan.
- **Page photos are kept.** After an apply the app uploads the page photo, shrunk in the browser to a JPEG of at most 2000px (about 300 KB), with `POST /api/page-photos?kind=&ref=&page=` (or `?collection=`). The server stores it as `<id>.jpg` in a `page-photos` folder next to the database (`/data/page-photos` on Railway, on the same volume) and a row in `page_photos` that links it to the paper page. A rescan adds a photo and keeps the older ones. `GET /api/page-photos/:id` serves one to its owner. A server with no photo folder (an in-memory database) keeps none and answers 503. In the Notes tab a scanned page with photos opens the photo from the index grid, and its row in the notebook has a small thumbnail.

### The OCR service

The scan needs the OCR service in `ocr/` (Python, slim image, Pillow and numpy only). It sends the page photo to a vision LLM and returns the lines. Point the app at it with `OCR_URL`. Without it the scan answers 503 and the rest of bujo works as before.

With Docker, one command starts both:

    docker compose up --build        # app on http://127.0.0.1:3000, OCR on the compose network only

Without Docker:

    cd ocr
    python -m venv .venv && . .venv/bin/activate
    pip install -r requirements.txt
    python -m bujo_ocr.server                # http://127.0.0.1:8090
    # then, in another shell, from the repo root:
    OCR_URL=http://127.0.0.1:8090 npm start

The OCR service has no auth, so keep it on a private network and never publish its port. Tests use a fake OCR server and a fake CalDAV server, never real photos or a real Nextcloud.

The LLM is the only reader: set `OCR_LLM_BASE`, `OCR_LLM_KEY` and, if you like, `OCR_LLM_MODEL` and `OCR_LLM_TIMEOUT` on the OCR service (compose passes them through). The service sends the whole page photo to a vision model behind that OpenAI-compatible gateway (for example a LiteLLM proxy). There is no local fallback. An answer that is not valid JSON, or a gateway that rejects `response_format`, is retried once (the second try for a format rejection drops `response_format`); other failures are not retried. When the LLM is not configured or fails, `POST /ocr` answers an error with a short `category` (it never holds the key or the photo): `503` `not configured`, or `502` with the reason (`timeout`, `network`, `http 401`, `invalid json`, `no lines`, `failed`). The app then shows "Couldn't read the page right now. Try again." and keeps the photo so you can retry. Page photos leave the OCR service for that gateway only. The answer carries `engine` `llm:<model>`, plus `tags` and `time` per line and a page `date`. Line boxes are always `[0, 0, 0, 0]`.

## Layout

- `src/caldav/`: CalDAV client (PROPFIND, REPORT, GET, PUT with ETag preconditions; no DELETE) and the ICS VTODO reader and writer.
- `src/accounts/`, `src/db.ts`: the one account, sessions, agent tokens, mail.
- `src/api/`: the task functions shared by `/api/v1` and `/mcp`. `src/routes/`: HTTP routes. `src/mcp/`: the MCP handler. `src/scan/`: the scan draft, matching and apply.
- `ocr/`: the OCR service (image decoding and the LLM reader) and its pytest tests.
- `src/app-kit/`, `public/app-kit/`: vendored app-kit v0.7.0. Never edit these. Update with `scripts/sync.sh` from the app-kit repo.
- `public/`: the plain JS frontend (backlog, sign-in pages, settings), `css/styles.css` (accent tokens), `sw.js`, and `manifest.webmanifest` (generated by app-kit's `scripts/manifest.mjs` from `manifest.config.json`).
- `test/`: node:test unit tests against a fake CalDAV server on 127.0.0.1, and Playwright specs in `test/ui/`.

## Checks

    scripts/check.sh

Runs `npm ci`, `typecheck`, `build`, `test`, `ocr` (the Python tests, in a venv under `ocr/.venv-test`) and `test:ui` quietly (logs in `/tmp/check-bujo-*.log`), stops at the first failure and prints `all checks passed`. The UI tests use the system Chrome at 390x844, once in light and once in dark. Tests use an in-memory database, the kit's stub mailer and the fake CalDAV server, never a real Nextcloud or real mail.
