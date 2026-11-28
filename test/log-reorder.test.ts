import assert from "node:assert/strict";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { reorderedIds } from "../src/log/order.ts";
import { createEntryStore } from "../src/log/store.ts";
import type { Entry } from "../src/log/types.ts";
import { api, signUp, withApp } from "./helpers.ts";

const USER = "user-1";
const DAY = "2026-11-20";

function setup() {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, ?, ?, ?)").run(USER, "Philipp", "hash", 1);
  const store = createEntryStore(db);
  const make = (title: string, date = DAY) => store.create(USER, { date, type: "task", title, tags: [], time: null }, 100);
  return { db, store, make };
}

const titles = (entries: Array<{ title: string }>) => entries.map((entry) => entry.title);

test("reorder puts the named entries in the new order and keeps ids, sync and timestamps", () => {
  const { store, make } = setup();
  const [a, b, c] = [make("a"), make("b"), make("c")];
  const day = store.reorder(USER, { date: DAY, horizon: "day" }, [c.id, a.id, b.id])!;
  assert.equal(day.length, 3);
  assert.deepEqual(titles(day), ["c", "a", "b"]);
  assert.deepEqual(day.map((entry) => entry.position), [0, 1, 2]);
  const kept = store.get(USER, c.id)!;
  assert.deepEqual({ id: kept.id, sync: kept.sync, updatedAt: kept.updatedAt }, { id: c.id, sync: c.sync, updatedAt: c.updatedAt });
  assert.deepEqual(titles(store.list(USER, { from: DAY, to: DAY })), ["c", "a", "b"]);
});

test("reorder of some entries leaves the others in their places, and another day alone", () => {
  const { store, make } = setup();
  make("a");
  const [b, , d] = [make("b"), make("c"), make("d")];
  const other = make("other", "2026-11-21");
  const day = store.reorder(USER, { date: DAY, horizon: "day" }, [d.id, b.id])!;
  assert.deepEqual(titles(day), ["a", "d", "c", "b"]);
  assert.equal(store.get(USER, other.id)!.position, 0);
});

test("reorder refuses an unknown id, another day's id, a repeat, and changes nothing", () => {
  const { store, make } = setup();
  const [a, b] = [make("a"), make("b")];
  const other = make("other", "2026-11-21");
  const slot = { date: DAY, horizon: "day" } as const;
  assert.equal(store.reorder(USER, slot, [b.id, "nope"]), undefined);
  assert.equal(store.reorder(USER, slot, [b.id, other.id]), undefined);
  assert.equal(store.reorder(USER, slot, [b.id, b.id]), undefined);
  assert.equal(store.reorder("someone-else", slot, [b.id, a.id]), undefined);
  assert.deepEqual(titles(store.list(USER, { from: DAY, to: DAY })), ["a", "b"]);
});

test("reorder keeps an entry inside its paper page and its page block before the unwritten ones", () => {
  const { store, make } = setup();
  const [a, b, c, d, loose] = [make("a"), make("b"), make("c"), make("d"), make("loose")];
  const slot = { date: DAY, horizon: "day" } as const;
  store.placeOnPaper(USER, slot, 1, [a.id, b.id]);
  store.placeOnPaper(USER, slot, 2, [c.id, d.id]);
  assert.deepEqual(titles(store.list(USER, { from: DAY, to: DAY })), ["a", "b", "c", "d", "loose"]);
  assert.deepEqual(titles(store.reorder(USER, slot, [b.id, a.id])!), ["b", "a", "c", "d", "loose"]);
  assert.equal(store.reorder(USER, slot, [c.id, a.id]), undefined);
  assert.equal(store.reorder(USER, slot, [loose.id, d.id]), undefined);
  assert.deepEqual(titles(store.list(USER, { from: DAY, to: DAY })), ["b", "a", "c", "d", "loose"]);
});

test("reorder clears an indent that would sit on the first entry", () => {
  const { store, make } = setup();
  const [a, b] = [make("a"), make("b")];
  store.update(USER, b.id, { indent: 1 }, 200);
  const day = store.reorder(USER, { date: DAY, horizon: "day" }, [b.id, a.id])!;
  assert.deepEqual(day.map((entry) => entry.indent), [0, 0]);
});

test("reorderedIds is pure: same input, same answer, input untouched", () => {
  const entry = (id: string, page: number | null) => ({ id, page }) as Entry;
  const day = [entry("a", 1), entry("b", 1), entry("c", null)];
  assert.deepEqual(reorderedIds(day, ["b", "a"]), ["b", "a", "c"]);
  assert.deepEqual(reorderedIds(day, ["b", "a"]), ["b", "a", "c"]);
  assert.equal(reorderedIds(day, ["c", "a"]), null);
  assert.deepEqual(reorderedIds(day, []), ["a", "b", "c"]);
});

test("POST /api/entries/order saves the order, answers the day, and a repeat is the same", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const { headers } = await signUp(base);
    const ids: string[] = [];
    for (const title of ["eins", "zwei", "drei"]) {
      ids.push((await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title }, headers })).json.entry.id);
    }
    const body = { date: DAY, horizon: "day", ids: [ids[2], ids[0], ids[1]] };
    const first = await api(base, "POST", "/api/entries/order", { body, headers });
    assert.equal(first.status, 200);
    assert.deepEqual(titles(first.json.entries), ["drei", "eins", "zwei"]);
    const again = await api(base, "POST", "/api/entries/order", { body, headers });
    assert.deepEqual(again.json, first.json);
    const listed = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers });
    assert.deepEqual(titles(listed.json.entries), ["drei", "eins", "zwei"]);
    assert.deepEqual(listed.json.entries.map((e: { sync: string }) => e.sync), first.json.entries.map((e: { sync: string }) => e.sync));
  });
});

test("POST /api/entries/order checks the body and the session", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "POST", "/api/entries/order", { body: { date: DAY, horizon: "day", ids: [] } })).status, 401);
    const { headers } = await signUp(base);
    const id = (await api(base, "POST", "/api/entries", { body: { date: DAY, type: "task", title: "x" }, headers })).json.entry.id;
    const post = (body: unknown) => api(base, "POST", "/api/entries/order", { body, headers });
    assert.equal((await post({ date: "nope", horizon: "day", ids: [id] })).status, 400);
    assert.equal((await post({ date: DAY, horizon: "week", ids: [id] })).status, 400);
    assert.equal((await post({ date: DAY, horizon: "day", ids: "x" })).status, 400);
    assert.equal((await post({ date: DAY, horizon: "day", ids: [1] })).status, 400);
    assert.equal((await post({ date: DAY, horizon: "day", ids: [id, "other"] })).status, 404);
    assert.equal((await api(base, "GET", "/api/entries/order", { headers })).status, 405);
  });
});
