import assert from "node:assert/strict";
import test from "node:test";
import { openDb, type Db } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import type { NewEntry } from "../src/log/types.ts";

const USER = "user-1";

function setup(): { db: Db; store: ReturnType<typeof createEntryStore> } {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
  return { db, store: createEntryStore(db) };
}

const entry = (over: Partial<NewEntry> = {}): NewEntry => ({ date: "2026-11-20", type: "task", title: "Tasche packen", tag: null, time: null, ...over });

test("create stores the entry with sync local and puts it at the end of its day", () => {
  const { store } = setup();
  const first = store.create(USER, entry({ title: "one" }), 100);
  const second = store.create(USER, entry({ title: "two", tag: "Reise", type: "event", time: "13:00" }), 200);
  const other = store.create(USER, entry({ date: "2026-11-21", title: "next day" }), 300);
  assert.equal(first.sync, "local");
  assert.equal(first.position, 0);
  assert.equal(second.position, 1);
  assert.equal(other.position, 0);
  assert.deepEqual({ tag: second.tag, time: second.time, type: second.type }, { tag: "Reise", time: "13:00", type: "event" });
  assert.deepEqual({ created: first.createdAt, updated: first.updatedAt }, { created: 100, updated: 100 });
  assert.match(first.id, /^[0-9a-f-]{36}$/);
});

test("list returns a date range sorted by date then position", () => {
  const { store } = setup();
  store.create(USER, entry({ date: "2026-11-21", title: "c" }), 1);
  store.create(USER, entry({ date: "2026-11-20", title: "a" }), 2);
  store.create(USER, entry({ date: "2026-11-20", title: "b" }), 3);
  store.create(USER, entry({ date: "2026-11-30", title: "outside" }), 4);
  const titles = store.list(USER, { from: "2026-11-20", to: "2026-11-21" }).map((e) => e.title);
  assert.deepEqual(titles, ["a", "b", "c"]);
  assert.deepEqual(store.list(USER, { from: "2026-12-01", to: "2026-12-02" }), []);
});

test("get finds an entry of this user only", () => {
  const { store } = setup();
  const made = store.create(USER, entry(), 1);
  assert.equal(store.get(USER, made.id)?.title, "Tasche packen");
  assert.equal(store.get(USER, "nope"), undefined);
  assert.equal(store.get("someone-else", made.id), undefined);
  assert.equal(store.list("someone-else", { from: "2026-01-01", to: "2026-12-31" }).length, 0);
});

test("update changes the given fields, keeps the rest and never touches sync", () => {
  const { store } = setup();
  const made = store.create(USER, entry({ tag: "Reise", time: "09:00" }), 100);
  const edited = store.update(USER, made.id, { title: "Koffer packen", type: "done", time: null }, 500)!;
  assert.deepEqual(
    { title: edited.title, type: edited.type, tag: edited.tag, time: edited.time, sync: edited.sync },
    { title: "Koffer packen", type: "done", tag: "Reise", time: null, sync: "local" },
  );
  assert.deepEqual({ created: edited.createdAt, updated: edited.updatedAt }, { created: 100, updated: 500 });
  assert.equal(store.update(USER, "nope", { title: "x" }, 1), undefined);
  assert.equal(store.update("someone-else", made.id, { title: "x" }, 1), undefined);
});

test("update to another day moves the entry to the end of that day", () => {
  const { store } = setup();
  const a = store.create(USER, entry({ title: "a" }), 1);
  store.create(USER, entry({ title: "b" }), 2);
  store.create(USER, entry({ date: "2026-11-22", title: "z" }), 3);
  const moved = store.update(USER, a.id, { date: "2026-11-22" }, 4)!;
  assert.equal(moved.position, 1);
  assert.deepEqual(store.list(USER, { from: "2026-11-22", to: "2026-11-22" }).map((e) => e.title), ["z", "a"]);
  // Staying on the same day keeps the place.
  const same = store.update(USER, moved.id, { title: "a2", date: "2026-11-22" }, 5)!;
  assert.equal(same.position, 1);
});

test("the table refuses a type or sync state it does not know", () => {
  const { db } = setup();
  const insert = (type: string, sync: string) =>
    db
      .prepare("INSERT INTO entries (id, user_id, date, type, title, sync, position, created_at, updated_at) VALUES (?, ?, '2026-11-20', ?, 't', ?, 0, 1, 1)")
      .run(`id-${type}-${sync}`, USER, type, sync);
  assert.throws(() => insert("idea", "local"));
  assert.throws(() => insert("task", "maybe"));
  assert.doesNotThrow(() => insert("migrated", "error"));
});
