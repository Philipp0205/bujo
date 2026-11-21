import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const entry = (over: Partial<NewEntry> = {}): NewEntry => ({ date: "2026-11-20", type: "task", title: "Tasche packen", tags: [], time: null, ...over });

test("create stores the entry with sync local and puts it at the end of its day", () => {
  const { store } = setup();
  const first = store.create(USER, entry({ title: "one" }), 100);
  const second = store.create(USER, entry({ title: "two", tags: ["Reise"], type: "event", time: "13:00" }), 200);
  const other = store.create(USER, entry({ date: "2026-11-21", title: "next day" }), 300);
  assert.equal(first.sync, "local");
  assert.equal(first.position, 0);
  assert.equal(second.position, 1);
  assert.equal(other.position, 0);
  assert.deepEqual({ tags: second.tags, time: second.time, type: second.type }, { tags: ["Reise"], time: "13:00", type: "event" });
  assert.deepEqual(first.tags, []);
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

test("listNotes returns only free notes of any day, newest day first, ties by newest created", () => {
  const { store } = setup();
  const note = (title: string, date: string, now: number, body = "# " + title) => store.create(USER, entry({ type: "note", title, date, body }), now);
  note("old", "2026-01-05", 1);
  note("tie first", "2026-11-20", 2);
  note("tie second", "2026-11-20", 3);
  note("newest", "2026-12-24", 4);
  store.create(USER, entry({ title: "plain task" }), 5);
  store.create(USER, entry({ type: "note", title: "short line" }), 6);
  store.create(USER, entry({ type: "note", title: "empty body", body: "" }), 7);
  assert.deepEqual(store.listNotes(USER).map((e) => e.title), ["newest", "tie second", "tie first", "old"]);
  assert.deepEqual(store.listNotes("someone-else"), []);
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
  const made = store.create(USER, entry({ tags: ["Reise"], time: "09:00" }), 100);
  const edited = store.update(USER, made.id, { title: "Koffer packen", type: "done", time: null }, 500)!;
  assert.deepEqual(
    { title: edited.title, type: edited.type, tags: edited.tags, time: edited.time, sync: edited.sync },
    { title: "Koffer packen", type: "done", tags: ["Reise"], time: null, sync: "local" },
  );
  assert.deepEqual({ created: edited.createdAt, updated: edited.updatedAt }, { created: 100, updated: 500 });
  assert.equal(store.update(USER, "nope", { title: "x" }, 1), undefined);
  assert.equal(store.update("someone-else", made.id, { title: "x" }, 1), undefined);
});

test("several tags keep their order, a new list replaces the old one, and an empty list clears it", () => {
  const { store } = setup();
  const made = store.create(USER, entry({ tags: ["work", "Reise", "Küche"] }), 1);
  assert.deepEqual(made.tags, ["work", "Reise", "Küche"]);
  assert.deepEqual(store.get(USER, made.id)?.tags, ["work", "Reise", "Küche"]);
  assert.deepEqual(store.update(USER, made.id, { tags: ["Küche", "neu"] }, 2)!.tags, ["Küche", "neu"]);
  assert.deepEqual(store.update(USER, made.id, { title: "other" }, 3)!.tags, ["Küche", "neu"], "a patch without tags keeps them");
  assert.deepEqual(store.update(USER, made.id, { tags: [] }, 4)!.tags, []);
  assert.deepEqual(store.list(USER, { from: "2026-11-20", to: "2026-11-20" })[0].tags, []);
});

test("removing an entry removes its tags", () => {
  const { db, store } = setup();
  const made = store.create(USER, entry({ tags: ["a", "b"] }), 1);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM entry_tags").get() as { n: number }).n, 2);
  store.remove(USER, made.id);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM entry_tags").get() as { n: number }).n, 0);
});

test("listTags counts each tag once per entry ignoring case, with the newest spelling, newest use first", () => {
  const { store } = setup();
  store.create(USER, entry({ tags: ["Reise", "work"] }), 100);
  store.create(USER, entry({ tags: ["reise"] }), 300);
  store.create(USER, entry({ tags: ["Küche"] }), 200);
  assert.deepEqual(store.listTags(USER), [
    { tag: "reise", count: 2, lastUsed: 300 },
    { tag: "Küche", count: 1, lastUsed: 200 },
    { tag: "work", count: 1, lastUsed: 100 },
  ]);
  assert.deepEqual(store.listTags("nobody"), [], "another user's tags are never listed");
});

test("an old database with single tags moves them into the list once, and a tag cleared later stays cleared", () => {
  const dir = mkdtempSync(join(tmpdir(), "bujo-tags-"));
  const path = join(dir, "old.db");
  try {
    const first = openDb(path);
    first.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
    const store = createEntryStore(first);
    const tagged = store.create(USER, entry({ title: "tagged" }), 1);
    const plain = store.create(USER, entry({ title: "plain" }), 2);
    first.prepare("UPDATE entries SET tag = 'Haushalt', scan_key = 'k', scan_type = 'task', scan_title = 'tagged', scan_tag = 'Haushalt', scan_at = 5 WHERE id = ?").run(tagged.id);
    first.prepare("UPDATE entries SET scan_key = 'p', scan_type = 'task', scan_title = 'plain', scan_tag = NULL, scan_at = 5 WHERE id = ?").run(plain.id);
    first.exec("DELETE FROM migrations");
    first.exec("UPDATE entries SET scan_tags = NULL");
    first.close();

    for (let round = 0; round < 2; round++) {
      const reopened = openDb(path);
      const list = createEntryStore(reopened).listScan(USER, { from: "2026-11-20", to: "2026-11-20" });
      const byTitle = (title: string) => list.find((item) => item.title === title)!;
      assert.deepEqual(byTitle("tagged").tags, round === 0 ? ["Haushalt"] : [], `round ${round}: cleared in round 0 stays cleared`);
      assert.deepEqual(byTitle("tagged").scan?.tags, ["Haushalt"]);
      assert.deepEqual(byTitle("plain").tags, []);
      assert.deepEqual(byTitle("plain").scan?.tags, []);
      if (round === 0) createEntryStore(reopened).update(USER, tagged.id, { tags: [] }, 9);
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

test("move swaps with the neighbour, does nothing at the ends, and the order is kept", () => {
  const { store } = setup();
  const [a, b, c] = ["a", "b", "c"].map((title, i) => store.create(USER, entry({ title }), i + 1));
  const titles = (list: Array<{ title: string }>) => list.map((e) => e.title);
  assert.deepEqual(titles(store.move(USER, b.id, "up")!), ["b", "a", "c"]);
  assert.deepEqual(titles(store.move(USER, b.id, "up")!), ["b", "a", "c"]);
  assert.deepEqual(titles(store.move(USER, a.id, "down")!), ["b", "c", "a"]);
  assert.deepEqual(titles(store.move(USER, a.id, "down")!), ["b", "c", "a"]);
  assert.deepEqual(titles(store.list(USER, { from: "2026-11-20", to: "2026-11-20" })), ["b", "c", "a"]);
  assert.deepEqual(store.list(USER, { from: "2026-11-20", to: "2026-11-20" }).map((e) => e.position), [0, 1, 2]);
  assert.equal(store.get(USER, c.id)?.updatedAt, 3);
  assert.equal(store.move(USER, "nope", "up"), undefined);
  assert.equal(store.move("someone-else", a.id, "up"), undefined);
});

test("indent nests under the entry above, never the first entry, and a move out of first place clears it", () => {
  const { store } = setup();
  const a = store.create(USER, entry({ title: "a" }), 1);
  const b = store.create(USER, entry({ title: "b" }), 2);
  assert.equal(store.update(USER, a.id, { indent: 1 }, 3)!.indent, 0);
  assert.equal(store.update(USER, b.id, { indent: 1 }, 4)!.indent, 1);
  assert.equal(store.update(USER, b.id, { indent: 0 }, 5)!.indent, 0);
  store.update(USER, b.id, { indent: 1 }, 6);
  const day = store.move(USER, b.id, "up")!;
  assert.deepEqual(day.map((e) => [e.title, e.indent]), [["b", 0], ["a", 0]]);
});

test("an entry that changes day leaves its indent behind and the old day is renumbered", () => {
  const { store } = setup();
  store.create(USER, entry({ title: "a" }), 1);
  const b = store.create(USER, entry({ title: "b" }), 2);
  const c = store.create(USER, entry({ title: "c" }), 3);
  store.update(USER, b.id, { indent: 1 }, 4);
  const moved = store.update(USER, b.id, { date: "2026-11-22" }, 5)!;
  assert.equal(moved.indent, 0);
  assert.deepEqual(store.list(USER, { from: "2026-11-20", to: "2026-11-20" }).map((e) => [e.title, e.position]), [["a", 0], ["c", 1]]);
  assert.equal(store.get(USER, c.id)?.position, 1);
});

test("remove deletes the row and photo, renumbers the day and answers what is left", () => {
  const { db, store } = setup();
  const a = store.create(USER, entry({ title: "a" }), 1);
  const b = store.create(USER, entry({ title: "b" }), 2);
  const c = store.create(USER, entry({ title: "c" }), 3);
  store.update(USER, c.id, { indent: 1 }, 4);
  const left = store.remove(USER, a.id)!;
  assert.deepEqual(left.map((e) => [e.title, e.position, e.indent]), [["b", 0, 0], ["c", 1, 1]]);
  assert.equal(store.get(USER, a.id), undefined);
  assert.equal(store.get(USER, b.id)?.position, 0);
  assert.equal(store.remove(USER, a.id), undefined);
  assert.equal(store.remove("someone-else", b.id), undefined);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n, 2);
});

test("an old database without the indent column is migrated on open and keeps its entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "bujo-indent-"));
  const path = join(dir, "old.db");
  try {
    const first = openDb(path);
    first.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
    createEntryStore(first).create(USER, entry({ title: "old" }), 1);
    first.exec("ALTER TABLE entries DROP COLUMN indent");
    first.close();
    const reopened = openDb(path);
    const [old] = createEntryStore(reopened).list(USER, { from: "2026-11-20", to: "2026-11-20" });
    assert.deepEqual({ title: old.title, indent: old.indent }, { title: "old", indent: 0 });
    reopened.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an old database without the scan columns gets them on open, safe twice, and provenance is not an edit", () => {
  const dir = mkdtempSync(join(tmpdir(), "bujo-scan-cols-"));
  const path = join(dir, "old.db");
  const columns = (db: Db) => (db.prepare("PRAGMA table_info(entries)").all() as Array<{ name: string }>).map((c) => c.name);
  const SCAN = ["scan_key", "scan_type", "scan_title", "scan_tag", "scan_tags", "scan_time", "scan_at"];
  try {
    const first = openDb(path);
    first.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
    const made = createEntryStore(first).create(USER, entry({ title: "old" }), 1);
    for (const name of SCAN) first.exec(`ALTER TABLE entries DROP COLUMN ${name}`);
    assert.equal(SCAN.some((name) => columns(first).includes(name)), false);
    first.close();
    for (let round = 0; round < 2; round++) {
      const reopened = openDb(path);
      assert.deepEqual(SCAN.filter((name) => columns(reopened).includes(name)), SCAN);
      const store = createEntryStore(reopened);
      assert.equal(store.listScan(USER, { from: "2026-11-20", to: "2026-11-20" })[0].scan === null, round === 0, "reopening keeps what was stamped");
      store.setScanProvenance(USER, made.id, { key: "old", type: "task", title: "old", tags: [], time: null, at: 50 });
      const [stamped] = store.listScan(USER, { from: "2026-11-20", to: "2026-11-20" });
      assert.deepEqual(stamped.scan, { key: "old", type: "task", title: "old", tags: [], time: null, at: 50 });
      assert.equal(stamped.updatedAt, 1, "stamping leaves updated_at alone");
      assert.equal("scan" in store.list(USER, { from: "2026-11-20", to: "2026-11-20" })[0], false, "list never carries provenance");
      reopened.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
