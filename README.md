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
| `PORT`, `HOST` | Listen address. Default `3000` and `127.0.0.1`. |
| `BUJO_TRUST_PROXY` | `1` behind a reverse proxy, so rate limits use `X-Forwarded-For`. Leave unset otherwise. |

Set `BUJO_CALDAV_BASE` and `BUJO_CALDAV_LISTS` together, or neither. Behind HTTPS, set `BUJO_ORIGIN` to the `https://` address so the cookie is marked Secure.

Other endpoints: `GET /healthz`, `GET /api/backlog` (browser session only; `?status=all` adds completed and cancelled), `/api/auth/*` and `/api/tokens` for the pages, static files from `public/`.

## Layout

- `src/caldav/`: CalDAV client (PROPFIND, REPORT, GET, PUT with ETag preconditions; no DELETE) and the ICS VTODO reader and writer.
- `src/accounts/`, `src/db.ts`: the one account, sessions, agent tokens, mail.
- `src/api/`: the task functions shared by `/api/v1` and `/mcp`. `src/routes/`: HTTP routes. `src/mcp/`: the MCP handler.
- `src/app-kit/`, `public/app-kit/`: vendored app-kit v0.7.0. Never edit these. Update with `scripts/sync.sh` from the app-kit repo.
- `public/`: the plain JS frontend (backlog, sign-in pages, settings), `css/styles.css` (accent tokens), `sw.js`, and `manifest.webmanifest` (generated by app-kit's `scripts/manifest.mjs` from `manifest.config.json`).
- `test/`: node:test unit tests against a fake CalDAV server on 127.0.0.1, and Playwright specs in `test/ui/`.

## Checks

    scripts/check.sh

Runs `npm ci`, `typecheck`, `build`, `test` and `test:ui` quietly (logs in `/tmp/check-bujo-*.log`), stops at the first failure and prints `all checks passed`. The UI tests use the system Chrome at 390x844, once in light and once in dark. Tests use an in-memory database, the kit's stub mailer and the fake CalDAV server, never a real Nextcloud or real mail.
