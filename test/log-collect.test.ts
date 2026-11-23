import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { openDb } from "../src/db.ts";
import { applyCollect, checkCollectTarget, COLLECT_MESSAGES, planCollect } from "../src/log/collect.ts";
import { updateEntry } from "../src/log/move.ts";
import { createEntryStore } from "../src/log/store.ts";
import { createTraceStore } from "../src/log/trace.ts";
import { BODY_MAX, checkEntryPatch } from "../src/log/validation.ts";
import { createSyncService } from "../src/sync/service.ts";
import { LIST_PATHS, SYNC_SETTINGS, startFakeCalDav, syncEnv } from "./fake-caldav.ts";
import { api, signUp, withApp } from "./helpers.ts";

const USER = "user-1";
const DAY = "2026-11-20";
const RANGE = { from: "2026-01-01", to: "2028-12-31" };

function setup() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
  const store = createEntryStore(db);
  const make = (title: string, over: Partial<Parameters<typeof store.create>[1]> = {}) => store.create(USER, { date: DAY, type: "task", title, tags: [], time: null, ...over }, 100);
  return { db, store, traces: createTraceStore(db), make };
}

test("checkCollectTarget takes a collection id, or a title and a day, and nothing else", () => {
  assert.deepEqual(checkCollectTarget({ collectionId: "c1" }), { ok: true, value: { collectionId: "c1" } });
  assert.deepEqual(checkCollectTarget({ title: "Garten", date: DAY }), { ok: true, value: { title: "Garten", date: DAY } });
  for (const body of [{}, { collectionId: 5 }, { collectionId: "c1", title: "x" }, { title: "x" }, { title: "x", date: DAY, more: 1 }]) {
    assert.equal(checkCollectTarget(body).ok, false, JSON.stringify(body));
  }
});

test("a move into a collection appends a line, leaves a collected trace with the collection title, and removes the entry", () => {
  const { db, store, traces, make } = setup();
  const collection = make("Garten", { type: "note", body: "# Garten\n- Beet 1\n" });
  const entry = make("Kompost umschichten");
  const plan = planCollect(db, USER, entry.id, { collectionId: collection.id });
  assert.ok(!("error" in plan));
  const after = applyCollect(db, USER, plan as Exclude<typeof plan, { error: string }>, 200);
  assert.equal(after.body, "# Garten\n- Beet 1\n- Kompost umschichten");
  assert.equal(store.get(USER, entry.id), undefined);
  assert.deepEqual(traces.list(USER, RANGE).map((t) => ({ entryId: t.entryId, date: t.date, horizon: t.horizon, kind: t.kind, title: t.title })), [
    { entryId: collection.id, date: DAY, horizon: "day", kind: "collected", title: "Garten" },
  ]);
});

test("a new collection is made from a title and a day, with the entry as its first line", () => {
  const { db, store, traces, make } = setup();
  const entry = make("Ersatzteile suchen");
  const plan = planCollect(db, USER, entry.id, { title: "  Werkstatt ", date: "2026-11-25" });
  assert.ok(!("error" in plan));
  const created = applyCollect(db, USER, plan as Exclude<typeof plan, { error: string }>, 200);
  assert.deepEqual({ title: created.title, date: created.date, type: created.type, body: created.body }, { title: "Werkstatt", date: "2026-11-25", type: "note", body: "- Ersatzteile suchen" });
  assert.equal(store.listNotes(USER).length, 1);
  assert.equal(traces.list(USER, RANGE)[0]!.title, "Werkstatt");
});

test("a move is refused for an unknown entry or collection, a free note, itself, a bad title or day", () => {
  const { db, make } = setup();
  const entry = make("Eintrag");
  const note = make("Notiz", { type: "note", body: "x" });
  const short = make("Kurze Notiz", { type: "note" });
  const refusal = (id: string, target: Parameters<typeof planCollect>[3]) => planCollect(db, USER, id, target) as { status: number; error: string };
  assert.equal(refusal("nope", { collectionId: note.id }).status, 404);
  assert.equal(refusal(entry.id, { collectionId: "nope" }).status, 404);
  assert.equal(refusal(entry.id, { collectionId: short.id }).error, COLLECT_MESSAGES.unknownCollection);
  assert.equal(refusal(note.id, { collectionId: note.id }).error, COLLECT_MESSAGES.notAnEntry);
  assert.equal(refusal(entry.id, { title: "  ", date: DAY }).status, 400);
  assert.equal(refusal(entry.id, { title: "T", date: "2026-02-30" }).status, 400);
});

test("a body that would pass BODY_MAX is refused with a clear error, and one that just fits is accepted", () => {
  const { db, store, make } = setup();
  const entry = make("abcd");
  const line = "- abcd";
  const full = make("Voll", { type: "note", body: "x".repeat(BODY_MAX - line.length - 1) });
  const fits = planCollect(db, USER, entry.id, { collectionId: full.id });
  assert.ok(!("error" in fits));
  store.update(USER, full.id, { body: "x".repeat(BODY_MAX - line.length) }, 5);
  const refused = planCollect(db, USER, entry.id, { collectionId: full.id }) as { status: number; error: string };
  assert.deepEqual({ status: refused.status, error: refused.error }, { status: 400, error: COLLECT_MESSAGES.tooLong });
  assert.match(refused.error, /50000/);
  assert.ok(store.get(USER, entry.id));
});

test("a collected trace stays when the collection moves to that day, and an edit cannot ask for one", () => {
  const { db, traces, make } = setup();
  const collection = make("Garten", { type: "note", body: "- a" });
  const entry = make("Eintrag");
  applyCollect(db, USER, planCollect(db, USER, entry.id, { collectionId: collection.id }) as never, 200);
  updateEntry(db, USER, collection.id, { date: "2026-12-01" }, 300);
  updateEntry(db, USER, collection.id, { date: DAY }, 400);
  assert.equal(traces.list(USER, RANGE).length, 1);
  assert.equal(checkEntryPatch({ date: DAY, trace: "collected" }).ok, false);
});

test("deleting the collection takes its collected traces with it", () => {
  const { db, store, traces, make } = setup();
  const collection = make("Garten", { type: "note", body: "- a" });
  applyCollect(db, USER, planCollect(db, USER, make("Eintrag").id, { collectionId: collection.id }) as never, 200);
  store.remove(USER, collection.id);
  assert.deepEqual(traces.list(USER, RANGE), []);
});

test("POST /api/entries/:id/collect files the entry, answers the collection, and the trace is listed with the day", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const day = async () => (await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}&traces=1`, { headers })).json;
    const made = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Zelt flicken" }, headers })).json.entry;
    const moved = await api(base, "POST", `/api/entries/${made.id}/collect`, { body: { title: "Camping", date: DAY }, headers });
    assert.equal(moved.status, 200);
    assert.deepEqual({ title: moved.json.collection.title, body: moved.json.collection.body }, { title: "Camping", body: "- Zelt flicken" });
    const listed = await day();
    assert.deepEqual(listed.entries.map((e: { title: string }) => e.title), ["Camping"]);
    assert.deepEqual(listed.traces.map((t: { kind: string; title: string }) => [t.kind, t.title]), [["collected", "Camping"]]);

    const second = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Pfeffer kaufen" }, headers })).json.entry;
    const again = await api(base, "POST", `/api/entries/${second.id}/collect`, { body: { collectionId: moved.json.collection.id }, headers });
    assert.equal(again.json.collection.body, "- Zelt flicken\n- Pfeffer kaufen");
    const notes = await api(base, "GET", "/api/entries?kind=notes", { headers });
    assert.equal(notes.json.entries[0].body, "- Zelt flicken\n- Pfeffer kaufen");
  });
});

test("POST /collect answers a clear error for a bad body, an unknown entry, a missing collection and a full collection", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const entry = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "x" }, headers })).json.entry;
    const full = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "note", title: "Voll", body: "y".repeat(BODY_MAX - 3) }, headers })).json.entry;
    const call = (id: string, body: unknown, method = "POST") => api(base, method, `/api/entries/${id}/collect`, { body, headers });
    assert.equal((await call(entry.id, {})).status, 400);
    assert.equal((await call("nope", { collectionId: full.id })).status, 404);
    assert.equal((await call(entry.id, { collectionId: "nope" })).status, 404);
    assert.equal((await call(entry.id, undefined, "GET")).status, 405);
    const refused = await call(entry.id, { collectionId: full.id });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /collection is full/);
    assert.equal((await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers })).json.entries.length, 2);
    const unsigned = await api(base, "POST", `/api/entries/${entry.id}/collect`, { body: { collectionId: full.id } });
    assert.equal(unsigned.status, 401);
  });
});

test("a synced task is set to CANCELLED in Nextcloud before it leaves, and nothing is deleted there", async () => {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  const service = createSyncService({ db, caldav: loadCalDavConfig(syncEnv(fake))!, sync: { ...SYNC_SETTINGS }, log: () => undefined });
  const box = LIST_PATHS["bujo-test"];
  try {
    await withApp(demoSource(), async ({ base }) => {
      const { headers } = await signUp(base);
      const made = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Dachrinne reinigen" }, headers })).json.entry;
      await service.idle();
      const collection = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "note", title: "Haus", body: "- eins" }, headers })).json.entry;
      const names = fake.names(box);
      assert.equal(names.length, 1);
      assert.ok(fake.read(box, names[0]!)!.includes("STATUS:NEEDS-ACTION"));

      const moved = await api(base, "POST", `/api/entries/${made.id}/collect`, { body: { collectionId: collection.id }, headers });
      assert.equal(moved.status, 200);
      assert.ok(fake.read(box, names[0]!)!.includes("STATUS:CANCELLED"));
      assert.equal(fake.requests.some((request) => request.method === "DELETE"), false);
      assert.equal(fake.names(box).length, 1);
      const listed = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers });
      assert.deepEqual(listed.json.entries.map((e: { title: string }) => e.title), ["Haus"]);
    }, { db, sync: service });
  } finally {
    await service.idle();
    await fake.close();
  }
});

test("when Nextcloud cannot cancel the task, it is not moved and the error says so", async () => {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  const service = createSyncService({ db, caldav: loadCalDavConfig(syncEnv(fake))!, sync: { ...SYNC_SETTINGS }, log: () => undefined });
  try {
    await withApp(demoSource(), async ({ base }) => {
      const { headers } = await signUp(base);
      const made = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "Dachrinne reinigen" }, headers })).json.entry;
      await service.idle();
      const collection = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "note", title: "Haus", body: "- eins" }, headers })).json.entry;
      fake.switches.conflictOnPut = true;
      const refused = await api(base, "POST", `/api/entries/${made.id}/collect`, { body: { collectionId: collection.id }, headers });
      assert.equal(refused.status, 502);
      assert.match(refused.json.error, /Could not cancel the task in Nextcloud/);
      const notes = await api(base, "GET", "/api/entries?kind=notes", { headers });
      assert.equal(notes.json.entries[0].body, "- eins");
      const day = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}&traces=1`, { headers });
      assert.deepEqual([day.json.entries.length, day.json.traces.length], [2, 0]);
    }, { db, sync: service });
  } finally {
    await service.idle();
    await fake.close();
  }
});

test("a traces table made before the collected kind is rebuilt on open with its rows kept, and then takes that kind", () => {
  const dir = mkdtempSync(join(tmpdir(), "bujo-collected-"));
  try {
    const file = join(dir, "bujo.db");
    const first = openDb(file);
    first.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
    const made = createEntryStore(first).create(USER, { date: DAY, type: "task", title: "x", tags: [], time: null }, 1);
    first.exec("DROP TABLE entry_traces");
    first.exec(`CREATE TABLE entry_traces (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, date TEXT NOT NULL,
      horizon TEXT NOT NULL CHECK (horizon IN ('day', 'month-calendar', 'month-task', 'future')),
      kind TEXT NOT NULL CHECK (kind IN ('migrated', 'scheduled')), title TEXT NOT NULL, created_at INTEGER NOT NULL)`);
    const insert = (db: typeof first, id: string, kind: string) => db.prepare("INSERT INTO entry_traces VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, USER, made.id, DAY, "day", kind, "t", 1);
    insert(first, "t1", "migrated");
    assert.throws(() => insert(first, "t2", "collected"));
    first.close();

    const reopened = openDb(file);
    assert.deepEqual(reopened.prepare("SELECT id FROM entry_traces").all().map((r) => r.id), ["t1"]);
    assert.doesNotThrow(() => insert(reopened, "t3", "collected"));
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
