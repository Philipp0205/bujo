import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb, type Db } from "../src/db.ts";
import { updateEntry } from "../src/log/move.ts";
import { markWritten } from "../src/log/paper.ts";
import { createEntryStore } from "../src/log/store.ts";
import { createTraceStore } from "../src/log/trace.ts";
import type { NewEntry } from "../src/log/types.ts";
import { checkEntryPatch } from "../src/log/validation.ts";
import { api, signUp, withApp } from "./helpers.ts";

const USER = "user-1";
const RANGE = { from: "2026-01-01", to: "2028-12-31" };

function setup() {
  const db: Db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
  return { db, store: createEntryStore(db), traces: createTraceStore(db) };
}

const entry = (over: Partial<NewEntry> = {}): NewEntry => ({ date: "2026-11-20", type: "task", title: "Tasche packen", tags: [], time: null, ...over });

test("a move keeps the id and takes the last day of the month for a month or future lane, February included", () => {
  const { db, store } = setup();
  const made = store.create(USER, entry(), 100);
  const toMonth = updateEntry(db, USER, made.id, { date: "2026-11-30", horizon: "month-task", trace: "migrated" }, 200)!;
  assert.deepEqual({ id: toMonth.id, date: toMonth.date, horizon: toMonth.horizon }, { id: made.id, date: "2026-11-30", horizon: "month-task" });
  const toFuture = updateEntry(db, USER, made.id, { date: "2027-02-28", horizon: "future", trace: "migrated" }, 300)!;
  assert.deepEqual({ id: toFuture.id, date: toFuture.date, horizon: toFuture.horizon }, { id: made.id, date: "2027-02-28", horizon: "future" });
  const leap = updateEntry(db, USER, made.id, { date: "2028-02-10", horizon: "future" }, 400)!;
  assert.equal(leap.date, "2028-02-29");
  assert.equal(store.list(USER, RANGE).length, 1);
});

test("a move turns an event into a task in a month lane and leaves the sync link as it was (no second UID)", () => {
  const { db, store } = setup();
  const made = store.create(USER, entry({ type: "event", time: "10:00" }), 100);
  store.setSync(USER, made.id, { sync: "synced", link: { href: "/cal/a.ics", uid: "uid-1", etag: "e1" } });
  const moved = updateEntry(db, USER, made.id, { date: "2026-12-31", horizon: "future", trace: "migrated" }, 200)!;
  assert.equal(moved.type, "task");
  assert.deepEqual(store.getRemote(USER, made.id), { href: "/cal/a.ics", uid: "uid-1", etag: "e1" });
  const uids = db.prepare("SELECT COUNT(remote_uid) AS n FROM entries WHERE user_id = ?").get(USER) as { n: number };
  assert.equal(uids.n, 1);
});

test("a trace is a local note: not an entry row, no UID, stored with the old page and the old title", () => {
  const { db, store, traces } = setup();
  const made = store.create(USER, entry({ title: "Alt" }), 100);
  updateEntry(db, USER, made.id, { title: "Neu", date: "2026-11-21", trace: "migrated" }, 200);
  assert.equal(store.list(USER, RANGE).length, 1);
  const [trace] = traces.list(USER, RANGE);
  assert.deepEqual(
    { entryId: trace!.entryId, date: trace!.date, horizon: trace!.horizon, kind: trace!.kind, title: trace!.title },
    { entryId: made.id, date: "2026-11-20", horizon: "day", kind: "migrated", title: "Alt" },
  );
  const columns = db.prepare("PRAGMA table_info(entry_traces)").all() as Array<{ name: string }>;
  assert.equal(columns.some((column) => column.name.startsWith("remote_")), false);
});

test("a schedule leaves a scheduled trace, and a move that asks for none leaves none", () => {
  const { db, store, traces } = setup();
  const a = store.create(USER, entry({ title: "A" }), 100);
  const b = store.create(USER, entry({ title: "B" }), 100);
  updateEntry(db, USER, a.id, { date: "2026-11-25", trace: "scheduled" }, 200);
  updateEntry(db, USER, b.id, { date: "2026-11-25" }, 200);
  assert.deepEqual(traces.list(USER, RANGE).map((trace) => [trace.entryId, trace.kind]), [[a.id, "scheduled"]]);
});

test("an edit that stays on the page leaves no trace, and a replay of a move adds no second one", () => {
  const { db, store, traces } = setup();
  const made = store.create(USER, entry(), 100);
  updateEntry(db, USER, made.id, { title: "Umbenannt", trace: "migrated" }, 200);
  assert.equal(traces.list(USER, RANGE).length, 0);
  const change = { date: "2026-11-22", trace: "migrated" } as const;
  updateEntry(db, USER, made.id, change, 300);
  updateEntry(db, USER, made.id, change, 400);
  assert.equal(traces.list(USER, RANGE).length, 1);
});

test("a move back to the old page clears the trace that stood there", () => {
  const { db, store, traces } = setup();
  const made = store.create(USER, entry(), 100);
  updateEntry(db, USER, made.id, { date: "2026-12-31", horizon: "future", trace: "migrated" }, 200);
  assert.equal(traces.list(USER, RANGE).length, 1);
  updateEntry(db, USER, made.id, { date: "2026-11-20", horizon: "day" }, 300);
  assert.equal(traces.list(USER, RANGE).length, 0);
});

test("a move with a trace takes the entry off paper, a plain edit does not", () => {
  const { db, store } = setup();
  const made = store.create(USER, entry(), 100);
  assert.equal(markWritten(store, USER, made.id, 150)!.onPaper, true);
  assert.equal(updateEntry(db, USER, made.id, { date: "2026-11-21" }, 200)!.onPaper, true);
  assert.equal(updateEntry(db, USER, made.id, { date: "2026-11-22", trace: "migrated" }, 300)!.onPaper, false);
});

test("deleting an entry takes its traces with it", () => {
  const { db, store, traces } = setup();
  const made = store.create(USER, entry(), 100);
  updateEntry(db, USER, made.id, { date: "2026-11-21", trace: "migrated" }, 200);
  assert.equal(traces.list(USER, RANGE).length, 1);
  store.remove(USER, made.id);
  assert.equal(traces.list(USER, RANGE).length, 0);
});

test("updateEntry on an unknown entry answers undefined and records nothing", () => {
  const { db, traces } = setup();
  assert.equal(updateEntry(db, USER, "missing", { date: "2026-11-21", trace: "migrated" }, 200), undefined);
  assert.equal(traces.list(USER, RANGE).length, 0);
});

test("checkEntryPatch takes a trace beside a change, and refuses a trace alone or a bad kind", () => {
  assert.deepEqual(checkEntryPatch({ date: "2026-11-21", trace: "scheduled" }), { ok: true, value: { date: "2026-11-21", trace: "scheduled" } });
  assert.equal(checkEntryPatch({ trace: "migrated" }).ok, false);
  for (const trace of ["done", "", null, 1, "Migrated"]) assert.equal(checkEntryPatch({ date: "2026-11-21", trace }).ok, false, JSON.stringify(trace));
});

test("PATCH with a trace moves the entry, GET with ?traces=1 lists the trace, a plain GET does not", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const made = await api(base, "POST", "/api/entries", { body: { date: "2026-11-20", type: "task", title: "Quer durch" }, headers });
    const id = made.json.entry.id as string;
    const patch = await api(base, "PATCH", `/api/entries/${id}`, { body: { date: "2026-12-31", horizon: "future", trace: "migrated" }, headers });
    assert.equal(patch.status, 200);
    assert.equal(patch.json.entry.id, id);
    assert.equal(patch.json.entry.trace, undefined);

    const range = "from=2026-11-01&to=2026-12-31";
    const plain = await api(base, "GET", `/api/entries?${range}`, { headers });
    assert.equal(plain.json.traces, undefined);
    const withTraces = await api(base, "GET", `/api/entries?${range}&traces=1`, { headers });
    assert.deepEqual(withTraces.json.entries.map((e: { id: string }) => e.id), [id]);
    assert.deepEqual(
      withTraces.json.traces.map((t: { entryId: string; date: string; horizon: string; kind: string; title: string }) => [t.entryId, t.date, t.horizon, t.kind, t.title]),
      [[id, "2026-11-20", "day", "migrated", "Quer durch"]],
    );
  });
});

test("PATCH refuses a trace alone and a bad trace kind with a 400", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const made = await api(base, "POST", "/api/entries", { body: { date: "2026-11-20", type: "task", title: "Bleibt" }, headers });
    const path = `/api/entries/${made.json.entry.id}`;
    assert.equal((await api(base, "PATCH", path, { body: { trace: "migrated" }, headers })).status, 400);
    assert.equal((await api(base, "PATCH", path, { body: { date: "2026-11-21", trace: "deleted" }, headers })).status, 400);
    assert.equal((await api(base, "GET", `/api/entries?from=2026-11-01&to=2026-11-30`, { headers })).json.entries[0].date, "2026-11-20");
  });
});
