# bujo product brief

## Goals

Keep the paper bullet journal as the daily working surface, and give the long-lived backlog a digital home in Nextcloud Tasks so it can be viewed, filtered, and updated without rewriting pages.

The app is the evening bridge: scan the day's paper page, review every proposed change, then sync accepted items to CalDAV. Philipp's agents can work with the same backlog and scan review through a versioned API and MCP.

## Non-goals

- Replacing the paper journal, or printing back onto paper.
- A general-purpose task manager with its own task database. Tasks live in Nextcloud via CalDAV. A small local store is only for auth users, sessions, auth links, and hashed agent API tokens.
- Touching VEVENT calendars, deleting collections, or deleting items without an explicit yes.
- Sending journal photos or task text to a third-party OCR or API, except as a fallback after the spike if no on-device or self-hosted option is good enough. In that case, real page photos leave the box only for that service.
- Multi-user or public access. This is a private, single-user app. Agent tokens are for Philipp's own agents, not a public API.
- Calendar sync or a handoff to the tasks bot in v1. Bujo does not trigger calendar blocks.
- A preset list of project or category tags. Tags are created freely in the app.
- A CLI in v1, unless a thin wrapper around the API is trivial.

## Hybrid flow

1. **Paper day page.** During the day, work happens in the notebook with the usual bullets: `•` task, `x` done, `>` migrated, `<` scheduled.
2. **Digital backlog.** Open and lingering items live in Nextcloud Tasks (VTODO), not as a second daily log. The app shows the backlog in a few views (below).
3. **Evening scan.** Photograph the day page, run OCR, then go through a mandatory review screen. Nothing is written to Nextcloud until each line is accepted, edited, or rejected.

## Backlog views

- By tag (via `CATEGORIES`; no preset names, created freely in the app)
- By priority (`1` high, `5` medium, `9` low, or unset)
- Someday/maybe: items tagged `CATEGORIES:someday` (no separate list)
- Scheduled (`<`): items with a DUE date

## CalDAV mapping

Based on the current Nextcloud state (Aufgaben and Arbeit).

### Lists

Only two VTODO lists are in play:

- **Aufgaben** (`/remote.php/dav/calendars/admin/tasks/`) - personal. Default for anything that is not clearly work.
- **Arbeit** (`/remote.php/dav/calendars/admin/arbeit/`) - work. Use only when the item is clearly work.

All other calendars are VEVENT and off-limits. Never delete collections. Tests use a separate test list, never these two.

### Projects and categories

`CATEGORIES` is unused today, so tagging via `CATEGORIES` is safe and is in v1. There is no preset list of project or category names. Philipp creates tags freely in the app (and agents can too, through the API). `someday` is one such tag, not a reserved taxonomy beyond that convention.

### Priority

Stick to the values already used in Nextcloud: `1` high, `5` medium, `9` low, `0` or absent unset. Do not invent other levels.

### Scheduled (`<`) and dates

- `DUE` is the deadline. Write new dues as `DUE;VALUE=DATE:YYYYMMDD`. Some older items have a TZID time; do not rewrite those unless we are changing the date.
- `<` scheduled maps to a `DUE` date.
- Do not write `DTSTART`. Clients sometimes set it; the tasks bot does not use or write it.

### Status and symbols

- `•` open task → `STATUS:NEEDS-ACTION` (default for new items).
- `x` done → `STATUS:COMPLETED`, plus a `COMPLETED` timestamp and `PERCENT-COMPLETE:100`.
- `<` scheduled → keep as an open task with a `DUE` date.
- `>` migrated → the item moves into the backlog (or is created there) and is not treated as done. Matching an existing VTODO is preferred over creating a duplicate.

Rare existing values (`IN-PROCESS`, `CANCELLED`, `RELATED-TO` subtasks) must be preserved if we edit those items. v1 does not need to create them.

Text is mostly German. Commas in text are escaped in iCalendar.

Write rules:

- Fresh UID per new item.
- Create with `PUT` and `If-None-Match: *`.
- Preserve unknown properties on edit.
- Read back after every write.
- No item deletes without a yes.

### Someday/maybe

No someday list. Tag items with `CATEGORIES:someday`. Today, undated open items act as someday in practice; in the app, someday is this explicit tag, not "undated = someday".

### Matching scanned lines to VTODOs

When a scanned line may already exist in the backlog, match in this order:

1. A stored UID from a previous sync, if we have one for that line.
2. Fuzzy title match against open items on the two lists (German text, tolerate OCR noise).

Ambiguous or weak matches stay unmatched until the review screen decides: update the existing item, create a new one, or skip.

### Integration with the tasks bot

The tasks bot's weekday ~08:00 routine reads both lists for overdue and due-today items, and it books calendar blocks for every `DUE` it writes.

v1 does not sync the calendar and does not hand off to the tasks bot. Bujo does not trigger calendar blocks. Writing `DUE` on the real lists may later need a handoff so those blocks stay consistent; that is out of v1.

The tasks bot also writes the same Nextcloud lists. The bujo API (below) is an additional path into those lists, not a replacement for the tasks bot.

## Evening scan flow

1. Photograph today's day page, or pick a photo already on the phone. Real page photos are never committed.
2. Run OCR on the self-hosted OCR service. Extract each bullet line: symbol and text. The page date is read from the first date line.
3. Show the **review screen** before any CalDAV write. For every line: accept as proposed, edit (text, list, due date, tag, priority, someday tag, or match to an existing item), or reject (drop, no write).
4. Only after the review is finished, sync the accepted lines: create or update VTODOs as mapped above, then read back and show the result.
5. If sync fails mid-way, report what was written and what was not. Do not retry blindly in a way that could duplicate items.

Nothing syncs from a raw OCR result. The review is mandatory. An agent can read a draft through the API; only Philipp's explicit accept in the app syncs those lines.

### As built

- `/scan` (signed-in session only): take or pick a photo, upload it, review, accept. Linked from the backlog.
- `POST /api/scan` takes the raw image (`image/jpeg`, `png`, `webp`, `heic`, at most 15 MB), runs OCR, and answers a draft. The photo is held in memory for that one call. It is never written to disk and never stored.
- `GET /api/scan/:id` reads a draft. A session or any agent token (read or write) may do this.
- `POST /api/scan/:id/apply` writes the accepted lines through the same task functions as `/api/v1`. Session only: an agent gets 403. A draft can be applied once (a second apply is 409). A request with one invalid item writes nothing and leaves the draft open. Once writing starts, the first failure stops the run, the rest are reported as not tried, and nothing is retried.
- Drafts live in memory for 24 hours, at most 5 at a time. A restart drops them.
- Symbols map to actions: `x` completes the matching open task (included only when one matches), `•` and `>` keep a matching task or create a new one, `<` sets a due date (asked for in the review, written as an all-day `DUE`), `○` and `–` and lines without a symbol are never synced.
- The page date is read from the first plain line that parses as a date, else it is the scan day (Europe/Berlin). It is shown in the review and not written to any task.
- Matching is fuzzy on normalized German text (case, punctuation and umlaut spelling ignored), with a small word list for known misreadings (for example `Tush` and `Tash` for `Task`). A weak or ambiguous match is never applied on its own: the review shows the candidates.
- Nothing is deleted. The new endpoints have no delete.

## OCR approach

The OCR service is a separate small Python container (`ocr/`), reached through `OCR_URL`. It is self-hosted and CPU only, so no photo leaves the box.

- A symbol detector (OpenCV, no model) finds the lines and classifies the leading symbol (`•`, `x`, `>`, `<`, `○`, `–`). It removes the dot grid before measuring.
- The text of each line is read by TrOCR small handwritten.
- Tesseract (English and German, run on stdin and stdout so nothing touches disk) reads a line when TrOCR is not installed, fails, or returns nothing. The engine that read each line is reported per line.
- The symbol is detected separately from the text, and every line is checked and corrected by hand in the review.
- Accuracy numbers from real page photos are not in this repo (the photos are private). Measure them with the spike plan below before relying on a recognizer.

Other options that were considered:

- PaddleOCR
- A small local VLM on the VPS

If a third-party service is ever needed, that is a later decision from numbers, not before. Real page photos stay out of git.

Spike plan used: run 3-5 real day-page photos (kept private, not in git) and measure:

- Symbol accuracy (`•`, `x`, `>`, `<`)
- Text accuracy (German handwriting or print)
- Latency on the intended hardware (phone and/or VPS)

Pick a path from those numbers, not from a demo on clean print.

## Agent access (API + MCP)

v1 includes a way for Philipp's agents (Grok Bots and OpenCode) to work with the same backlog and evening scan, without a second task store.

### HTTP API

A versioned JSON HTTP API on the same server, under `/api/v1`.

It covers:

- Backlog read and filter (list, tag, priority, someday, scheduled/due, open or completed)
- Create, update, and complete tasks
- Tags (`CATEGORIES`), created freely, with no preset list
- Scan reading a draft (agents are read only here: upload and accept stay with the signed-in app)

### Agent auth

Agents do not use app-kit user sessions. They authenticate with per-agent API tokens:

- Sent as a bearer token
- Revocable
- Scope is read or read/write
- Stored hashed in the same `node:sqlite` auth store
- Created and revoked in the app's settings

### MCP

An MCP server (streamable HTTP) is a thin wrapper over that API and uses the same tokens, so Grok Bots and OpenCode agents can call it directly.

A thin CLI is out of v1 unless it is trivial (a small wrapper around the same API).

### Rules

Agent writes follow the same rules as the app. Scan results still need review: an agent can read a draft (`GET /api/scan/:id`), but upload and apply need Philipp's signed-in session, so only his explicit accept syncs those lines to Nextcloud, unless he later changes that. No deletes without a yes.

The tasks bot also writes the same Nextcloud lists. The bujo API is an additional path into those lists, not a replacement for the tasks bot, and v1 still does not hand off calendar blocks.

## v1

**In**

- Backlog views over the two real lists (tags via `CATEGORIES`, created freely with no presets; priority 1/5/9; someday via `CATEGORIES:someday`; scheduled/due).
- Evening scan with mandatory per-line review, then CalDAV create/update as mapped above.
- OCR spike and a first working recognizer that is good enough for review (the human still corrects). Prefer on-device or self-hosted; third-party only as a fallback after the spike.
- Dark mode: light and dark, following the system `prefers-color-scheme` via app-kit theme tokens.
- Full app-kit auth (email via Resend) and deploy as below.
- Agent access: versioned JSON HTTP API (`/api/v1`) and a streamable-HTTP MCP server, with per-agent bearer tokens.
- A separate test list and fixtures. Tests never touch Aufgaben or Arbeit.

**Out**

- Replacing or transcribing the whole notebook.
- Writing `DTSTART`, deleting items or collections, or editing VEVENT calendars.
- A second task database.
- A new Someday list (someday is a `CATEGORIES` tag).
- A preset list of project or category tags.
- Multi-user features or public sharing.
- Calendar sync or a handoff to the tasks bot. Bujo does not trigger calendar blocks in v1. A later handoff may be needed when writing `DUE` on the real lists; that is out of v1.
- Third-party OCR as the first choice. It is only a fallback if the spike shows no on-device or self-hosted option is good enough.
- A CLI, unless a thin wrapper around the API is trivial.

## Auth, stack, and deploy

Shape follows Hangry (free-now) and pins **app-kit v0.7.0**.

Vendor app-kit with its `scripts/sync.sh` into `public/app-kit` (frontend) and `src/app-kit` (server). Each tree has a `VERSION` file, is committed, and is never edited locally.

Setup:

- `head.html` snippet
- `ak-tokens` accent
- Light and dark themes, following the system `prefers-color-scheme` via app-kit theme tokens. This is in v1.
- `ak-sw.js` service worker and `scripts/manifest.mjs`
- Skip `ak-view-transitions.css`
- `server/auth.ts`: full app-kit auth. The app implements `AuthStore` over a local `node:sqlite` store with `users`, `sessions`, and `auth_links` tables, per app-kit `docs/auth.md`.
- Email is mandatory, sent with Resend (`RESEND_API_KEY`, `MAIL_FROM`)
- Per-agent API tokens (hashed) live in that same sqlite store, separate from app-kit user sessions, and are created in the app's settings.

Tension to keep straight: there is still no separate task database. Tasks stay in CalDAV. Auth uses a small local `node:sqlite` store for users, sessions, auth links, and hashed agent API tokens only.

This is a single-user app, but it uses full app-kit auth, not Tailscale-only access.

Deploy on Hetzner, via the hetzner ops agent. Tailscale is the network layer for deploy (how the app is reached), not a substitute for app-kit login.
