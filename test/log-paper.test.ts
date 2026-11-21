import assert from "node:assert/strict";
import test from "node:test";
import { openDb, type Db } from "../src/db.ts";
import { markWritten, onPaper } from "../src/log/paper.ts";
import { editedInApp, fieldsOf, sameFields, snapshotFields, snapshotOf } from "../src/log/scan/fields.ts";
import { createEntryStore } from "../src/log/store.ts";
import type { NewEntry, ScanSnapshot } from "../src/log/types.ts";

const USER = "user-1";
const DAY = "2026-11-20";

function setup(): { db: Db; store: ReturnType<typeof createEntryStore> } {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
  return { db, store: createEntryStore(db) };
}

const input = (over: Partial<NewEntry> = {}): NewEntry => ({ date: DAY, type: "task", title: "Brot kaufen", tags: ["Haushalt"], time: "10:00", ...over });
const live = (over: Partial<ReturnType<typeof fieldsOf> & { updatedAt: number }> = {}) => ({ type: "task" as const, title: "Brot kaufen", tags: ["Haushalt"], time: "10:00" as string | null, updatedAt: 100, ...over });
const snap = (over: Partial<ScanSnapshot> = {}): ScanSnapshot => ({ key: "brot kaufen", type: "task", title: "Brot kaufen", tags: ["Haushalt"], time: "10:00", at: 50, ...over });

test("sameFields: a title matches up to case, spacing, punctuation and umlaut spelling", () => {
  const base = fieldsOf(live({ title: "Käse, kaufen!" }));
  assert.equal(sameFields(base, fieldsOf(live({ title: "kaese  kaufen" }))), true);
  assert.equal(sameFields(base, fieldsOf(live({ title: "Käse holen" }))), false);
});

test("sameFields: tags compare as a set, time is exact including null, the type must agree", () => {
  const base = fieldsOf(live({ tags: ["Reise", "work"] }));
  assert.equal(sameFields(base, fieldsOf(live({ tags: ["WORK", "reise", "Reise"] }))), true, "order, case and repeats do not matter");
  assert.equal(sameFields(base, fieldsOf(live({ tags: ["Reise"] }))), false);
  assert.equal(sameFields(fieldsOf(live({ time: null })), fieldsOf(live({ time: "" as unknown as null }))), false, "no time is null, nothing else");
  assert.equal(sameFields(fieldsOf(live({ time: null })), fieldsOf(live({ time: null }))), true);
  assert.equal(sameFields(fieldsOf(live({ time: "10:00" })), fieldsOf(live({ time: "10:01" }))), false);
  assert.equal(sameFields(fieldsOf(live({ type: "task" })), fieldsOf(live({ type: "done" }))), false);
});

test("snapshotOf keeps the four fields, the title key and the time of writing; snapshotFields reads them back", () => {
  const made = snapshotOf({ type: "event", title: "Käse, kaufen", tags: ["a"], time: null }, 7);
  assert.deepEqual(made, { key: "kaese kaufen", type: "event", title: "Käse, kaufen", tags: ["a"], time: null, at: 7 });
  assert.deepEqual(snapshotFields(made), { type: "event", title: "Käse, kaufen", tags: ["a"], time: null });
});

test("onPaper: no snapshot means not on paper, however old the entry is", () => {
  assert.equal(onPaper(live({ updatedAt: 1 }), null), false);
});

test("onPaper: a snapshot that matches the fields is on paper, with or without a later updatedAt", () => {
  assert.equal(onPaper(live({ updatedAt: 40 }), snap()), true);
  assert.equal(onPaper(live({ updatedAt: 500 }), snap()), true, "same fields after at: still on paper");
  assert.equal(onPaper(live({ updatedAt: 500, title: "brot  kaufen." , tags: ["haushalt"] }), snap()), true, "matchKey and tag-set equivalence");
});

test("onPaper: a changed type, title, tags or time after the snapshot is not on paper", () => {
  for (const over of [{ type: "done" as const }, { title: "Milch kaufen" }, { tags: ["Haushalt", "neu"] }, { tags: [] }, { time: "11:00" }, { time: null }]) {
    assert.equal(onPaper(live({ ...over, updatedAt: 500 }), snap()), false, JSON.stringify(over));
  }
});

test("onPaper: a field that differs but was saved before the snapshot counts as on paper (the scan wrote it)", () => {
  assert.equal(onPaper(live({ title: "Milch kaufen", updatedAt: 40 }), snap()), true);
  assert.equal(editedInApp(live({ title: "Milch kaufen", updatedAt: 40 }), snap()), false);
});

test("store: new entries are not on paper; stamping the current fields puts them on paper without an edit", () => {
  const { store } = setup();
  const made = store.create(USER, input(), 100);
  assert.equal(made.onPaper, false);
  store.setScanProvenance(USER, made.id, snapshotOf(made, 200));
  const stamped = store.get(USER, made.id)!;
  assert.equal(stamped.onPaper, true);
  assert.equal(stamped.updatedAt, 100, "stamping is not an edit");
});

test("store: an app edit of a compared field after the stamp takes it off paper; a body or indent change does not", () => {
  const { store } = setup();
  const made = store.create(USER, input(), 100);
  store.setScanProvenance(USER, made.id, snapshotOf(made, 200));
  assert.equal(store.update(USER, made.id, { body: "notes" }, 300)!.onPaper, true, "body is not compared");
  assert.equal(store.update(USER, made.id, { title: "Milch kaufen" }, 400)!.onPaper, false);
  assert.equal(store.update(USER, made.id, { title: "brot kaufen" }, 500)!.onPaper, true, "back to the same fields: on paper again");
  assert.equal(store.update(USER, made.id, { tags: [] }, 600)!.onPaper, false);
  assert.equal(store.update(USER, made.id, { time: null, tags: ["haushalt"] }, 700)!.onPaper, false);
});

test("store: every read carries onPaper and none carries the snapshot", () => {
  const { store } = setup();
  const a = store.create(USER, input({ title: "a" }), 1);
  const b = store.create(USER, input({ title: "b", body: "# note", type: "note" }), 2);
  store.setScanProvenance(USER, a.id, snapshotOf(a, 5));
  const range = { from: DAY, to: DAY };
  const everything = [...store.list(USER, range), ...store.listNotes(USER), store.get(USER, a.id)!, ...store.move(USER, b.id, "up")!, ...store.remove(USER, store.create(USER, input({ title: "gone" }), 9).id)!];
  for (const entry of everything) {
    assert.equal(typeof entry.onPaper, "boolean");
    assert.equal("scan" in entry, false);
    assert.equal(JSON.stringify(entry).includes("scan"), false);
  }
  assert.deepEqual(store.list(USER, range).map((e) => [e.title, e.onPaper]).sort(), [["a", true], ["b", false]]);
  assert.equal(store.setSync(USER, a.id, { sync: "synced" })!.onPaper, true);
  assert.equal(store.listScan(USER, range).find((e) => e.id === a.id)!.onPaper, true);
  assert.equal(store.listScan(USER, range).find((e) => e.id === a.id)!.scan?.key, "a");
});

test("markWritten stamps the current fields, leaves updated_at and sync alone, and is undefined for an unknown entry", () => {
  const { store } = setup();
  const made = store.create(USER, input(), 100);
  const written = markWritten(store, USER, made.id, 900)!;
  assert.equal(written.onPaper, true);
  assert.deepEqual({ updatedAt: written.updatedAt, sync: written.sync }, { updatedAt: 100, sync: "local" });
  assert.deepEqual(store.listScan(USER, { from: DAY, to: DAY })[0].scan, { key: "brot kaufen", type: "task", title: "Brot kaufen", tags: ["Haushalt"], time: "10:00", at: 900 });
  assert.equal(markWritten(store, USER, "nope", 1), undefined);
  assert.equal(markWritten(store, "someone-else", made.id, 1), undefined);
});
