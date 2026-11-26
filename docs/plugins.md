# Plugin architecture

Philipp asked for a plugin platform in the Eclipse spirit — "everything is a plugin" — and whether bujo could have something like the Obsidian Gemini Scribe plugin, with Android Auto as a use case. This is a design note only. No app behavior changes in this PR.

## What "everything is a plugin" would mean here

The kernel stays small. It owns the shell (app-kit auth, static files, the service worker, theme and font boot, `public/js/core.js`, the same-document router in `public/js/nav/`), storage and sync (`src/db.ts`, `src/sync/`, the CalDAV client and write guards), and the scan pipeline shell (photo upload, the OCR client, mandatory review, apply). The OCR service (`ocr/bujo_ocr`) stays a kernel service: it reads a page; it does not decide what a line means for the log. Sign-in, the tab bar and its history rules, photo storage, CSP, and health checks also stay in the kernel.

Everything a person uses is a plugin that fills extension points, the way Eclipse does: a manifest names the plugin, contributions fill extension points, and the plugin's code activates lazily the first time something needs it. Plugins are first-party and ship in this repo. There is no store, no loading code from the network, and no unsigned third-party plugins.

That is already half true in the code. The router already asks a tab for `show`, `scan`, `add`, and `warm`. Settings already slots in theme, font, and What's new as sections. The point is to make that the rule, not a habit.

Today's modules, mapped as plugins:

- **Daily log** — `public/js/log/*` (except horizon and scan parsers), `src/log/store.ts`, `src/routes/entries.ts`. Route `/`, add/select/delete, day-row renderers, paper pages.
- **Monthly and future log** — `public/js/log/horizon/`, `src/log/horizon.ts`. Month and Future views and their horizon slots.
- **Collections** — `public/js/collections/`, `src/log/collections.ts`, `src/routes/collections.ts`.
- **Backlog** — `public/js/backlog.js`, `public/backlog.html`, `/api/backlog`.
- **Notes** — `public/js/notes/`, `src/log/into-note.ts`. Route `/notes`.
- **Calendar events** — `src/caldav/vevent.ts`, `src/log/scan/calendar.ts`, event sync. Event type, VEVENT push, calendar-page parser.
- **Notebook index** — `public/js/index/`, `src/log/page-index.ts`.
- **Scan parsers** — `src/log/scan/` (`kind.ts`, `parse.ts`, `header.ts`, `months.ts`, `calendar.ts`, `future.ts`, plan/apply). One parser per `PageKind`: `daily`, `future`, `calendar`, `month-task`.
- **Account and tokens** — account and token cards in `public/js/settings.js`, `src/accounts/`, `src/routes/tokens.ts`.
- **MCP and the agent API** — `src/mcp/`, `src/routes/v1.ts`. Tools over entries, on top of the kernel's HTTP/MCP transport.

Habits are not a module today. A habit tracker on a monthly page would be a new scan parser and renderer, not a new kernel.

## A minimal plugin API

One registry, loaded at boot. A plugin is a manifest plus a `register(api)` function. `register` only declares contributions; work happens on `activate`.

```js
// manifest (a shape, not a new file format yet)
{
  id: "bujo.daily-log",
  name: "Daily log",
  version: 1,
  activatesOn: ["route:/", "command:log.scan", "scan-kind:daily"]
}

function register(api) {
  api.routes.add({ path: "/", tab: "log", title: "Rapid log", show, scan, add, warm });
  api.commands.add({ id: "log.scan", title: "Scan page", run });
  api.scanParsers.add({ kind: "daily", detect, parse });
  api.settings.add({ id: "daily-log", title: "Daily log", render });
  api.renderers.add({ type: "task", renderRow });
}
```

First-version contribution types only: views/routes, commands, scan block parsers, settings sections, and entry renderers. Lifecycle: manifest loaded → `register` → `activate` on the first matching trigger → optional `deactivate` when its route is left (nice later, not required at first). The server can grow the same registry for parsers and MCP tools; the first PRs can stay in the client plus the existing `detectKind` / `parse` split.

## Migration, in small PRs

Do not rewrite the app. Each step ships on its own and leaves behavior unchanged.

1. Add the registry and the manifest shape. The daily log is the first declared plugin; it still does what it does today.
2. Settings sections become contributions (theme, font, What's new, and tokens already almost are).
3. Scan `PageKind` parsers register themselves instead of a hard-coded switch in `kind.ts` / `parse.ts`.
4. Entry row renderers and commands (scan, add, move, delete) go through the registry.
5. Notes, collections, horizon, backlog, and the notebook index declare themselves the same way.
6. Only then add a first *new* plugin (an assistant, or habits).

The smallest useful version stops at step 3 or 4. That is enough to add a new scan kind or a settings card without touching the kernel. A full Eclipse/OSGi clone — services, `plugin.xml`, a marketplace, sandboxing — is too much for a single-user PWA. The risk of this work is over-engineering: extra indirection, slower changes, tests that check the registry instead of the log. If a step does not make the next feature cheaper, stop.

## Gemini Scribe, and Android Auto

[Gemini Scribe](https://github.com/allenhutchison/obsidian-gemini) ([README](https://github.com/allenhutchison/obsidian-gemini/blob/master/README.md)) is an Obsidian community plugin. It chats with an AI using the vault as context: an agent that can search, read, and edit notes (with a diff review and an optional plan before writes), summarization, selection rewrite, inline completions, custom prompts, and optional local models through Ollama. Cloud providers include Gemini, OpenAI, Anthropic, and OpenRouter. Sessions are saved as markdown in the vault.

A bujo equivalent would be a first-party **assistant plugin**, not a port of Scribe. It would talk over the backlog, daily log, and notes through the existing MCP and `/api/v1` tools (search, read, propose creates and edits). Voice capture is the useful bit in a car: "add buy milk to today", "what's open on my backlog". Writes should stay behind a review, the way a scan does. Self-hosted (Ollama, or a model next to the OCR box) should be the default path. Cloud providers only after an explicit yes.

Privacy constraint, unchanged: never send page photos or journal data to a third-party API without Philipp's yes. The assistant must not get raw scans unless he says so.

Android Auto will not run the PWA. [Official Android for Cars](https://developer.android.com/training/cars) only accepts certain native app categories (media, messaging, navigation, POI, IoT, weather, and a few parked types). A [Trusted Web Activity](https://developer.android.com/develop/ui/views/layout/webapps/trusted-web-activities) can put bujo on the Play Store for the phone; it does not project the web app onto the dash. The Browser category is Android Automotive OS only, parked, and still limited to a testing track. Gemini is replacing Assistant as the voice in Android Auto, but that does not give a web app a car UI.

Realistic options, cheapest first:

1. **Voice on the phone, plus the existing agent API.** A Scribe-like plugin with voice input, and Gemini/Assistant routines or a share-to-bujo path that posts a line of text. This covers capture while driving without a dash UI.
2. **Messaging-style notifications** from a tiny Android wrapper: hear a reminder, reply by voice, that reply becomes an entry. Supported on Android Auto, but it is a new native app, not the PWA.
3. **A Car App Library app** only if we can honestly fit a permitted category and accept Play review. A bullet journal does not fit today. Conversational templates are planned for the library; they still need a native app in a permitted category.

Do not build a car app until the assistant plugin works on the phone.

## Open questions

1. Is the goal of plugins mainly to keep *this* app modular, or do you also want to install and disable features yourself (and, later, third-party plugins)?
2. For the assistant, is self-hosted Ollama the default, or are you open to a cloud provider after a yes for each kind of data (text entries vs page photos)?
3. For Android Auto, is voice capture into today's log enough, or do you want a real dash UI (which means a native app)?
4. Should habits become their own plugin (tracker plus a monthly-page parser), or stay a kind of monthly log line?
5. Which slice should ship first: the registry (no user-visible change), or the assistant sketched on top of today's MCP API without waiting for the platform?
