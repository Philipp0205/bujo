import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { openDb, type Db } from "../src/db.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { createSyncService } from "../src/sync/service.ts";
import { LIST_PATHS, SYNC_SETTINGS, startFakeCalDav, syncEnv } from "./fake-caldav.ts";
import { line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { api, makeToken, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const DAY = "2026-11-20";

type Ctx = { base: string; ocr: FakeOcr; signed: Signed; db: Db };

/** The app with the demo source (no CalDAV) and the fake OCR. Nothing here reaches a real list. */
async function withLogScan(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base, db }) => {
      await fn({ base, ocr, signed: await signUp(base), db });
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
}

async function scan(base: string, headers: Record<string, string>, query = "", body: Buffer = PNG, type = "image/png") {
  const response = await fetch(`${base}/api/log/scan${query}`, { method: "POST", headers: { "content-type": type, ...headers }, body: new Uint8Array(body) });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}

const entriesOf = async (base: string, signed: Signed, date = DAY) =>
  (await api(base, "GET", `/api/entries?from=${date}&to=${date}`, { headers: signed.headers })).json.entries as Array<{ id: string; type: string; title: string; tags: string[]; sync: string }>;

const PAGE = [line("none", "20.11.2026"), line("•", "Brot kaufen", 0.94), line("○", "Lunch with Mira", 0.71), line("x", "Water the plants", 0.91)];

test("POST /api/log/scan: reads the page, answers a review and writes nothing", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    const { status, json } = await scan(base, signed.headers, "?date=2026-11-19");
    assert.equal(status, 201);
    assert.equal(json.draft.date, DAY);
    assert.equal(json.draft.pageDate, DAY);
    assert.equal(json.draft.fallbackDate, "2026-11-19");
    assert.deepEqual(json.draft.items.map((i: any) => [i.id, i.type, i.title, i.status, i.include]), [
      ["l2", "task", "Brot kaufen", "new", true],
      ["l3", "event", "Lunch with Mira", "new", true],
      ["l4", "done", "Water the plants", "new", true],
    ]);
    assert.equal(JSON.stringify(json).includes("userId"), false);
    assert.equal(ocr.requests.length, 1);
    assert.deepEqual(await entriesOf(base, signed), []);
  });
});

test("POST /api/log/scan: with no page date the day comes from ?date= and a bad ?date= is a 400", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines([line("•", "Brot kaufen")]);
    const ok = await scan(base, signed.headers, "?date=2026-11-18");
    assert.equal(ok.status, 201);
    assert.equal(ok.json.draft.date, "2026-11-18");
    assert.equal(ok.json.draft.pageDate, null);
    assert.equal((await scan(base, signed.headers, "?date=2026-13-40")).status, 400);
  });
});

test("POST /api/log/scan: needs a browser session, a photo type, and a working OCR", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    assert.equal((await scan(base, {})).status, 401);
    assert.equal((await scan(base, { cookie: "bujo_session=nope" })).status, 401);
    const token = (await makeToken(base, signed, "write")).token;
    assert.equal((await scan(base, { authorization: `Bearer ${token}` })).status, 403, "a token is not a browser session");
    assert.equal((await scan(base, signed.headers, "", Buffer.from("x"), "text/plain")).status, 415);
    assert.equal((await scan(base, signed.headers, "", Buffer.alloc(0))).status, 400);
    assert.equal((await api(base, "GET", "/api/log/scan", { headers: signed.headers })).status, 405);
    assert.equal(ocr.requests.length, 0, "a refused request never reaches OCR");
    ocr.failWith(500);
    assert.equal((await scan(base, signed.headers)).status, 502);
    assert.equal(ocr.requests.length, 1);
  });
});

test("apply: writes only the kept lines with their edits, updates the task an x line names, and runs once", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    const task = await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Water the plants" }, headers: signed.headers });
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    assert.equal(draft.items[2].status, "edited");
    assert.equal(draft.items[2].include, true);
    assert.equal(draft.items[2].target.id, task.json.entry.id);
    assert.deepEqual(draft.items[2].before, { type: "task", title: "Water the plants", tags: [], time: null });
    assert.deepEqual(draft.items[2].after, { type: "done", title: "Water the plants", tags: [], time: null });
    assert.equal(draft.items[0].before, null);

    const sent = {
      date: DAY,
      items: [
        { id: "l2", type: "note", title: "  Brot kaufen, Vollkorn ", tags: [" Haushalt ", "Einkauf"] },
        { id: "l4", type: "done", title: "Water the plants", tags: [] },
      ],
    };
    const applied = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: sent, headers: signed.headers });
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json.results.map((r: any) => [r.id, r.outcome]), [["l2", "created"], ["l4", "updated"]]);

    const entries = await entriesOf(base, signed);
    assert.equal(entries.length, 2, "the line that updates a task adds no entry");
    assert.deepEqual(entries.map((e) => [e.type, e.title, e.tags]), [["note", "Brot kaufen, Vollkorn", ["Haushalt", "Einkauf"]], ["done", "Water the plants", []]], "paper order: l2 then l4");
    assert.equal(entries.some((e) => e.title === "Lunch with Mira"), false, "a line that was not sent is not written");

    const again = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: sent, headers: signed.headers });
    assert.equal(again.status, 409);
    assert.equal((await entriesOf(base, signed)).length, 2);
  });
});

test("check: tells the review about another day without writing, and a bad request is a 400", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    await api(base, "POST", "/api/entries", { body: { date: "2026-11-21", type: "note", title: "Brot kaufen" }, headers: signed.headers });
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    const body = { date: "2026-11-21", items: [{ id: "l2", type: "task", title: "Brot kaufen" }, { id: "l3", type: "note", title: "Brot kaufen", tags: ["x"] }] };
    const checked = await api(base, "POST", `/api/log/scan/${draft.id}/check`, { body, headers: signed.headers });
    assert.equal(checked.status, 200);
    const note = { type: "note", title: "Brot kaufen", tags: [], time: null };
    assert.deepEqual(checked.json, {
      date: "2026-11-21",
      items: [
        { id: "l2", status: "edited", target: { id: checked.json.items[0].target.id, title: "Brot kaufen" }, before: note, after: { ...note, type: "task" }, contested: false },
        { id: "l3", status: "new", target: null, before: null, after: null, contested: false },
      ],
      page: 1,
      pages: [],
    });
    assert.equal((await entriesOf(base, signed, "2026-11-21")).length, 1);
    assert.equal((await api(base, "POST", `/api/log/scan/${draft.id}/check`, { body: { ...body, date: "nope" }, headers: signed.headers })).status, 400);
  });
});

/** Scans a page and answers the draft. */
async function scanLines(ctx: Ctx, lines: ReturnType<typeof line>[]) {
  ctx.ocr.setLines(lines);
  return (await scan(ctx.base, ctx.signed.headers)).json.draft;
}

const applyTo = (ctx: Ctx, draft: { id: string }, items: object[]) =>
  api(ctx.base, "POST", `/api/log/scan/${draft.id}/apply`, { body: { date: DAY, items }, headers: ctx.signed.headers });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PAGE_ONE = [line("none", "20.11.2026"), line("•", "Brot kaufen"), line("•", "Zahnarzt anrufen"), line("○", "Lunch mit Mira")];

test("rescan: updates the matched entries, adds only new lines and leaves entries missing from the page alone", async () => {
  await withLogScan(async (ctx) => {
    const first = await scanLines(ctx, PAGE_ONE);
    const sent = first.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
    assert.equal((await applyTo(ctx, first, sent)).status, 200);
    const created = await entriesOf(ctx.base, ctx.signed);
    assert.equal(created.length, 3);

    // Later the same page: Brot is ticked off, Zahnarzt got a tag and a time, Lunch is not on the page, Post is new.
    const second = await scanLines(ctx, [
      line("none", "20.11.2026"),
      line("x", "brot kaufen"),
      line("•", "Zahnarzt anrufen #health 14h30"),
      line("•", "Post abholen"),
    ]);
    assert.deepEqual(second.items.map((i: any) => [i.title, i.status, i.include]), [
      ["brot kaufen", "edited", true],
      ["Zahnarzt anrufen", "edited", true],
      ["Post abholen", "new", true],
    ]);
    const items = second.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title, tags: i.tags, time: i.time }));
    const applied = await applyTo(ctx, second, items);
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["updated", "updated", "created"]);

    const now = (await api(ctx.base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: ctx.signed.headers })).json.entries;
    assert.deepEqual(now.map((e: any) => [e.type, e.title, e.tags, e.time]), [
      ["done", "Brot kaufen", [], null],
      ["task", "Zahnarzt anrufen", ["health"], "14:30"],
      ["event", "Lunch mit Mira", [], null],
      ["task", "Post abholen", [], null],
    ]);
    assert.equal(now[0].id, created[0].id, "the entry was updated in place, not replaced");
    assert.equal(JSON.stringify(now).includes("scan_"), false, "no provenance on the public API");
    assert.equal(JSON.stringify(now).replaceAll('"origin":"scan"', "").includes("scan"), false);
  });
});

test("rescan: a page with only unchanged lines has nothing to apply, and skipped unchanged lines are recorded without an edit", async () => {
  await withLogScan(async (ctx) => {
    const seeded = await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Brot kaufen" }, headers: ctx.signed.headers });
    const draft = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen"), line("•", "Milch")]);
    assert.deepEqual(draft.items.map((i: any) => [i.status, i.include]), [["unchanged", false], ["new", true]]);
    const brot = { id: "l2", type: "task", title: "Brot kaufen", tags: [], time: null };

    const row = () => ctx.db.prepare("SELECT scan_key, scan_title, scan_at, updated_at, sync FROM entries WHERE id = ?").get(seeded.json.entry.id) as any;
    assert.equal(row().scan_key, null, "scanning and checking write nothing");
    await api(ctx.base, "POST", `/api/log/scan/${draft.id}/check`, { body: { date: DAY, items: [brot] }, headers: ctx.signed.headers });
    assert.equal(row().scan_key, null);

    assert.deepEqual(draft.items.map((i: any) => i.offPaper), [true, undefined], "the entry has no paper snapshot yet");

    const before = row();
    const ok = await applyTo(ctx, draft, [{ ...brot, include: false }, { id: "l3", type: "task", title: "Milch" }]);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.json.results.map((r: any) => r.outcome), ["created"]);
    const after = row();
    assert.equal(after.scan_key, "brot kaufen");
    assert.ok(after.scan_at > 0);
    assert.equal(after.updated_at, before.updated_at, "stamping is not an edit");
    assert.equal(after.sync, before.sync);
    assert.equal((await entriesOf(ctx.base, ctx.signed)).length, 2);

    const again = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen"), line("•", "Milch")]);
    assert.deepEqual(again.items.map((i: any) => [i.status, i.offPaper]), [["unchanged", undefined], ["unchanged", undefined]]);
    const none = await applyTo(ctx, again, [{ ...brot, include: true }]);
    assert.equal(none.status, 400, "everything is on paper already: an unchanged line is not a write, even when ticked");
  });
});

test("rescan: an entry the person changed in the app is not overwritten by an unchanged paper line", async () => {
  await withLogScan(async (ctx) => {
    const first = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen")]);
    await applyTo(ctx, first, [{ id: "l2", type: "task", title: "Brot kaufen" }]);
    const [entry] = await entriesOf(ctx.base, ctx.signed);
    await sleep(5);
    const edited = await api(ctx.base, "PATCH", `/api/entries/${entry.id}`, { body: { type: "migrated", tags: ["Haushalt"] }, headers: ctx.signed.headers });
    assert.equal(edited.status, 200);

    // The same paper line again: the entry differs from it only because of the app edit.
    const second = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen"), line("•", "Eier")]);
    assert.deepEqual(second.items.map((i: any) => [i.status, i.include]), [["unchanged", false], ["new", true]]);
    const paper = { id: "l2", type: "task", title: "Brot kaufen", tags: [], time: null };
    const applied = await applyTo(ctx, second, [{ ...paper, include: true }, { id: "l3", type: "task", title: "Eier" }]);
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["created"]);
    const [kept] = await entriesOf(ctx.base, ctx.signed);
    assert.deepEqual([kept.type, kept.tags], ["migrated", ["Haushalt"]]);
  });
});

test("rescan: when the paper closes a task the app only retagged, the paper wins and the line starts ticked", async () => {
  await withLogScan(async (ctx) => {
    const first = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen")]);
    await applyTo(ctx, first, [{ id: "l2", type: "task", title: "Brot kaufen" }]);
    const [entry] = await entriesOf(ctx.base, ctx.signed);
    await sleep(5);
    await api(ctx.base, "PATCH", `/api/entries/${entry.id}`, { body: { tags: ["Haushalt"] }, headers: ctx.signed.headers });

    const second = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Brot kaufen")]);
    const [item] = second.items;
    assert.deepEqual([item.status, item.include, item.contested], ["edited", true, true]);
    assert.deepEqual(item.before, { type: "task", title: "Brot kaufen", tags: ["Haushalt"], time: null });
    assert.deepEqual(item.after, { type: "done", title: "Brot kaufen", tags: ["Haushalt"], time: null });
    const applied = await applyTo(ctx, second, [{ id: "l2", type: "done", title: "Brot kaufen", tags: [], include: true }]);
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["updated"]);
    const [done] = await entriesOf(ctx.base, ctx.signed);
    assert.deepEqual([done.type, done.tags], ["done", ["Haushalt"]]);
  });
});

test("rescan: when the app also changed the type, a contested line stays unticked", async () => {
  await withLogScan(async (ctx) => {
    const first = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen")]);
    await applyTo(ctx, first, [{ id: "l2", type: "task", title: "Brot kaufen" }]);
    const [entry] = await entriesOf(ctx.base, ctx.signed);
    await sleep(5);
    await api(ctx.base, "PATCH", `/api/entries/${entry.id}`, { body: { type: "done" }, headers: ctx.signed.headers });

    const second = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen und Milch")]);
    const [item] = second.items;
    assert.deepEqual([item.status, item.include, item.contested], ["edited", false, true]);
  });
});

test("rescan: an update queues a sync push like a create does", async () => {
  const ocr = await startFakeOcr([]);
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  const service = createSyncService({ db, caldav: loadCalDavConfig(syncEnv(fake))!, sync: { ...SYNC_SETTINGS }, log: () => undefined });
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      const ctx: Ctx = { base, ocr, signed, db };
      const first = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen")]);
      const created = await applyTo(ctx, first, [{ id: "l2", type: "task", title: "Brot kaufen" }]);
      assert.equal(created.json.results[0].entry.sync, "pending");
      await service.idle();
      assert.equal((await entriesOf(base, signed))[0].sync, "synced");

      const second = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Brot kaufen")]);
      const updated = await applyTo(ctx, second, [{ id: "l2", type: "done", title: "Brot kaufen" }]);
      assert.deepEqual([updated.json.results[0].outcome, updated.json.results[0].entry.sync], ["updated", "pending"]);
      await service.idle();
      assert.equal((await entriesOf(base, signed))[0].sync, "synced");
    }, { db, sync: service, ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await service.idle();
    await fake.close();
    await ocr.close();
  }
});

test("apply: a paper line without * keeps a remote PRIORITY, and only an explicit important:false from the review removes it", async () => {
  const ocr = await startFakeOcr([]);
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  const service = createSyncService({ db, caldav: loadCalDavConfig(syncEnv(fake))!, sync: { ...SYNC_SETTINGS }, log: () => undefined });
  const box = LIST_PATHS["bujo-test"];
  const remote = () => fake.names(box).map((name) => fake.read(box, name)!).join("\n");
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      const ctx: Ctx = { base, ocr, signed, db };
      const made = await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Brot kaufen", important: true }, headers: signed.headers });
      await service.idle();
      assert.ok(remote().includes("PRIORITY:1"), "marking important writes PRIORITY:1");

      const plain = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Brot kaufen")]);
      await applyTo(ctx, plain, [{ id: "l2", type: "done", title: "Brot kaufen" }]);
      await service.idle();
      assert.ok(remote().includes("PRIORITY:1"), "a line with no * and no explicit off leaves the remote priority");
      assert.equal((await entriesOf(base, signed))[0].id, made.json.entry.id);

      const off = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen")]);
      const applied = await applyTo(ctx, off, [{ id: "l2", type: "task", title: "Brot kaufen", important: false }]);
      assert.equal(applied.json.results[0].entry.important, false);
      assert.equal("unflag" in applied.json.results[0], false, "the unflag marker is not sent to the browser");
      await service.idle();
      assert.equal(remote().includes("PRIORITY"), false, "an explicit off removes the remote priority");
    }, { db, sync: service, ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await service.idle();
    await fake.close();
    await ocr.close();
  }
});

test("apply: a paper line without * leaves an important entry important, and important:false clears it", async () => {
  await withLogScan(async (ctx) => {
    await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Brot kaufen", important: true }, headers: ctx.signed.headers });
    const flagOf = async () => ((await entriesOf(ctx.base, ctx.signed))[0] as { important?: boolean }).important;
    const plain = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Brot kaufen")]);
    await applyTo(ctx, plain, [{ id: "l2", type: "done", title: "Brot kaufen", important: false }]);
    assert.equal(await flagOf(), false, "an explicit false clears it");
    const again = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "* Brot kaufen")]);
    await applyTo(ctx, again, [{ id: "l2", type: "task", title: "Brot kaufen", important: true }]);
    assert.equal(await flagOf(), true);
    const last = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Brot kaufen")]);
    await applyTo(ctx, last, [{ id: "l2", type: "done", title: "Brot kaufen" }]);
    assert.equal(await flagOf(), true, "no mention of important keeps it");
  });
});

test("apply: a bad request writes nothing at all", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    const good = { id: "l2", type: "task", title: "Brot kaufen" };
    const bads: unknown[] = [
      { date: DAY, items: [] },
      { date: DAY, items: [good, { id: "l3", type: "event", title: "" }] },
      { date: DAY, items: [good, { id: "l3", type: "event", title: "x".repeat(201) }] },
      { date: DAY, items: [good, { id: "l9", type: "task", title: "Unbekannt" }] },
      { date: DAY, items: [good, good] },
      { date: DAY, items: [good, { id: "l3", type: "flag", title: "Falscher Typ" }] },
      { date: DAY, items: [{ ...good, extra: 1 }] },
      { date: DAY, items: [good], more: true },
      { date: "2026-02-30", items: [good] },
      { date: DAY, items: "nope" },
      { date: DAY, items: Array.from({ length: 201 }, () => good) },
    ];
    for (const body of bads) {
      const result = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body, headers: signed.headers });
      assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.deepEqual(await entriesOf(base, signed), []);
    const fine = await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body: { date: DAY, items: [good] }, headers: signed.headers });
    assert.equal(fine.status, 200, "a draft that failed validation can still be applied");
  });
});

/** The entries of the day as the public API lists them, with whether each is on paper. */
const storedOf = async (ctx: Ctx) =>
  (await api(ctx.base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: ctx.signed.headers })).json.entries as Array<{ id: string; type: string; title: string; onPaper: boolean }>;

test("fuzzy: a line with OCR noise is the same item, so apply adds no row and the entry keeps its own title and goes on paper", async () => {
  await withLogScan(async (ctx) => {
    await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Zahnarzt anrufen" }, headers: ctx.signed.headers });
    const draft = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Zahnarst anrufcn"), line("•", "Milch")]);
    assert.deepEqual(draft.items.map((i: any) => [i.title, i.status, i.target?.title ?? null]), [["Zahnarst anrufcn", "unchanged", "Zahnarzt anrufen"], ["Milch", "new", null]]);
    const applied = await applyTo(ctx, draft, [{ id: "l2", type: "task", title: "Zahnarst anrufcn", include: false }, { id: "l3", type: "task", title: "Milch" }]);
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["created"]);
    const rows = await storedOf(ctx);
    assert.deepEqual(rows.map((e) => [e.title, e.onPaper]), [["Zahnarzt anrufen", true], ["Milch", true]]);
  });
});

test("fuzzy: x over a task in the app marks that item done, misspelled title and all, with no second row", async () => {
  await withLogScan(async (ctx) => {
    const seeded = await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Zahnarzt anrufen" }, headers: ctx.signed.headers });
    const draft = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Zahnarst anrufen")]);
    assert.deepEqual([draft.items[0].status, draft.items[0].after.type, draft.items[0].after.title], ["edited", "done", "Zahnarzt anrufen"]);
    const applied = await applyTo(ctx, draft, [{ id: "l2", type: "done", title: "Zahnarst anrufen" }]);
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["updated"]);
    const rows = await storedOf(ctx);
    assert.deepEqual(rows.map((e) => [e.id, e.type, e.title, e.onPaper]), [[seeded.json.entry.id, "done", "Zahnarzt anrufen", true]]);
  });
});

test("fuzzy: > and < over a task apply the migration and the schedule to the same item", async () => {
  await withLogScan(async (ctx) => {
    await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Zahnarzt anrufen" }, headers: ctx.signed.headers });
    await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Brot kaufen" }, headers: ctx.signed.headers });
    const draft = await scanLines(ctx, [line("none", "20.11.2026"), line(">", "Zahnarzt anrufcn"), line("<", "Brot kaufn")]);
    assert.deepEqual(draft.items.map((i: any) => [i.status, i.after.type]), [["edited", "migrated"], ["edited", "scheduled"]]);
    const applied = await applyTo(ctx, draft, draft.items.map((i: any) => ({ id: i.id, type: i.type, title: i.title })));
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["updated", "updated"]);
    assert.deepEqual((await storedOf(ctx)).map((e) => [e.type, e.title]), [["migrated", "Zahnarzt anrufen"], ["scheduled", "Brot kaufen"]]);
  });
});

test("un-match: a kept line the person un-matched is created as a new entry and the matched item is left alone", async () => {
  await withLogScan(async (ctx) => {
    await api(ctx.base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Zahnarzt anrufen" }, headers: ctx.signed.headers });
    const draft = await scanLines(ctx, [line("none", "20.11.2026"), line("x", "Zahnarst anrufen")]);
    const checked = await api(ctx.base, "POST", `/api/log/scan/${draft.id}/check`, { body: { date: DAY, items: [{ id: "l2", type: "done", title: "Zahnarst anrufen", unmatched: true }] }, headers: ctx.signed.headers });
    assert.deepEqual([checked.json.items[0].status, checked.json.items[0].target], ["new", null]);
    const applied = await applyTo(ctx, draft, [{ id: "l2", type: "done", title: "Zahnarst anrufen", unmatched: true }]);
    assert.deepEqual(applied.json.results.map((r: any) => r.outcome), ["created"]);
    assert.deepEqual((await storedOf(ctx)).map((e) => [e.type, e.title]), [["done", "Zahnarst anrufen"], ["task", "Zahnarzt anrufen"]]);
  });
});

test("un-match: unmatched must be true or false", async () => {
  await withLogScan(async (ctx) => {
    const draft = await scanLines(ctx, [line("none", "20.11.2026"), line("•", "Brot kaufen")]);
    const bad = await applyTo(ctx, draft, [{ id: "l2", type: "task", title: "Brot kaufen", unmatched: "yes" }]);
    assert.equal(bad.status, 400);
  });
});

test("apply: an unknown draft is a 404, signed-out is a 401, an unknown step is a 404 and a GET is a 405", async () => {
  await withLogScan(async ({ base, ocr, signed }) => {
    ocr.setLines(PAGE);
    const draft = (await scan(base, signed.headers)).json.draft;
    const body = { date: DAY, items: [{ id: "l2", type: "task", title: "Brot kaufen" }] };
    assert.equal((await api(base, "POST", "/api/log/scan/nope/apply", { body, headers: signed.headers })).status, 404);
    assert.equal((await api(base, "POST", `/api/log/scan/${draft.id}/apply`, { body })).status, 401);
    assert.equal((await api(base, "POST", `/api/log/scan/${draft.id}/other`, { body, headers: signed.headers })).status, 404);
    assert.equal((await api(base, "GET", `/api/log/scan/${draft.id}/apply`, { headers: signed.headers })).status, 405);
  });
});
