# bujo product brief

## Goals

Keep the paper bullet journal as the daily working surface, and give the long-lived backlog a digital home in Nextcloud Tasks so it can be viewed, filtered, and updated without rewriting pages.

The app is the evening bridge: scan the day's paper page, review every proposed change, then sync accepted items to CalDAV.

## Non-goals

- Replacing the paper journal, or printing back onto paper.
- A general-purpose task manager with its own task database. Tasks live in Nextcloud via CalDAV. A small local store is only for auth users and sessions.
- Touching VEVENT calendars, deleting collections, or deleting items without an explicit yes.
- Sending journal photos or task text to a third-party OCR or API, except as a fallback after the spike if no on-device or self-hosted option is good enough. In that case, real page photos leave the box only for that service.
- Multi-user or public access. This is a private, single-user app.
- Calendar sync or a handoff to the tasks bot in v1. Bujo does not trigger calendar blocks.

## Hybrid flow

1. **Paper day page.** During the day, work happens in the notebook with the usual bullets: `•` task, `x` done, `>` migrated, `<` scheduled.
2. **Digital backlog.** Open and lingering items live in Nextcloud Tasks (VTODO), not as a second daily log. The app shows the backlog in a few views (below).
3. **Evening scan.** Photograph the day page, run OCR, then go through a mandatory review screen. Nothing is written to Nextcloud until each line is accepted, edited, or rejected.

## Backlog views

- By project or category (via `CATEGORIES`; names TBD)
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

`CATEGORIES` is unused today, so tagging projects or categories via `CATEGORIES` is safe and is in v1. The names themselves are still TBD (see open questions).

Someday is also a `CATEGORIES` tag, `someday`. It is not a new list.

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

## Evening scan flow

1. Photograph today's day page, or pick a photo already on the phone. Real page photos are never committed.
2. Run OCR locally or on the self-hosted VPS. Extract each bullet line: symbol, text, and any date or project hint.
3. Show the **review screen** before any CalDAV write. For every line: accept as proposed, edit (text, list, due date, project, priority, someday tag, or match to an existing item), or reject (drop, no write).
4. Only after the review is finished, sync the accepted lines: create or update VTODOs as mapped above, then read back and show the result.
5. If sync fails mid-way, report what was written and what was not. Do not retry blindly in a way that could duplicate items.

Nothing syncs from a raw OCR result. The review is mandatory.

## OCR approach

Prefer on-device or self-hosted:

- Tesseract
- PaddleOCR
- TrOCR
- A small local VLM on the VPS

If none of those is good enough after the spike, a third-party service is allowed as a fallback. That decision is made from the spike numbers, not before. If a third-party fallback is used, real page photos leave the box only for that service.

Spike plan: run 3-5 real day-page photos (kept private, not in git) and measure:

- Symbol accuracy (`•`, `x`, `>`, `<`)
- Text accuracy (German handwriting or print)
- Latency on the intended hardware (phone and/or VPS)

Pick a path from those numbers, not from a demo on clean print.

## v1

**In**

- Backlog views over the two real lists (project/category via `CATEGORIES`, priority 1/5/9, someday via `CATEGORIES:someday`, scheduled/due).
- Evening scan with mandatory per-line review, then CalDAV create/update as mapped above.
- OCR spike and a first working recognizer that is good enough for review (the human still corrects). Prefer on-device or self-hosted; third-party only as a fallback after the spike.
- Dark mode: light and dark, following the system `prefers-color-scheme` via app-kit theme tokens.
- Auth and deploy as below, pending the auth open question.
- A separate test list and fixtures. Tests never touch Aufgaben or Arbeit.

**Out**

- Replacing or transcribing the whole notebook.
- Writing `DTSTART`, deleting items or collections, or editing VEVENT calendars.
- A second task database.
- A new Someday list (someday is a `CATEGORIES` tag).
- Multi-user features or public sharing.
- Calendar sync or a handoff to the tasks bot. Bujo does not trigger calendar blocks in v1. A later handoff may be needed when writing `DUE` on the real lists; that is out of v1.
- Third-party OCR as the first choice. It is only a fallback if the spike shows no on-device or self-hosted option is good enough.

## Auth, stack, and deploy

Shape follows Hangry (free-now) and pins **app-kit v0.7.0**.

Vendor app-kit with its `scripts/sync.sh` into `public/app-kit` (frontend) and `src/app-kit` (server). Each tree has a `VERSION` file, is committed, and is never edited locally.

Setup:

- `head.html` snippet
- `ak-tokens` accent
- Light and dark themes, following the system `prefers-color-scheme` via app-kit theme tokens. This is in v1.
- `ak-sw.js` service worker and `scripts/manifest.mjs`
- Skip `ak-view-transitions.css`
- `server/auth.ts`: the app implements `AuthStore` over its own `users`, `sessions`, and `auth_links` tables, per app-kit `docs/auth.md`
- Email is mandatory, sent with Resend (`RESEND_API_KEY`, `MAIL_FROM`)

Tension to keep straight: there is still no separate task database. Tasks stay in CalDAV. Auth does need a small local store (for example `node:sqlite`) for users and sessions only.

This is a single-user app. Whether we want full app-kit auth or just to put the app behind Tailscale is still an open question.

Deploy on Hetzner, via the hetzner ops agent. Reachable over Tailscale.

## Open questions for Philipp

1. This is a single-user private app. Use full app-kit auth (email via Resend, local users/sessions store) or just put it behind Tailscale?
2. What are the project or category names to use in `CATEGORIES` for v1?
