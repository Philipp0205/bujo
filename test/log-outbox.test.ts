import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Item = { key: string; kind: "create" | "update"; id: string; body: Record<string, unknown>; indent: number; at: string; order: number; rev: number };
type Entry = Record<string, unknown> & { id: string; date: string; title: string; position: number; queued?: string };
type Model = {
  newId: () => string;
  isNetworkMiss: (error: unknown, online?: boolean) => boolean;
  verdict: (error: unknown, online?: boolean) => "later" | "drop";
  without: (items: Item[], key: string) => Item[];
  hasCreate: (items: Item[], id: string) => boolean;
  enqueueCreate: (items: Item[], values: Record<string, unknown>, indent: number, now: string) => Item[];
  enqueueUpdate: (items: Item[], id: string, patch: Record<string, unknown>, now: string) => Item[];
  afterSent: (items: Item[], sent: Item) => Item[];
  preview: (entry: Entry, items: Item[]) => Entry;
  merge: (base: Entry[], items: Item[]) => Entry[];
};

/** The outbox model, loaded the way a page loads it: one script that hangs itself on window.BujoLog. */
function loadModel(): Model {
  const window: { BujoLog?: { outbox: { model: Model } }; crypto?: unknown } = { crypto: { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) } };
  vm.runInNewContext(readFileSync(new URL("../public/js/log/outbox/model.js", import.meta.url), "utf8"), { window, Uint8Array, Date, Object, Array, Math });
  return window.BujoLog!.outbox.model;
}

const M = loadModel();
const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-22T10:00:00.000Z";
const values = (id: string, title: string) => ({ id, date: "2026-11-22", type: "task", title, tags: [], time: null });
const saved = (id: string, title: string, position: number): Entry => ({ id, date: "2026-11-22", type: "task", title, tags: [], position, indent: 0, sync: "synced" });

test("newId makes a UUID the server accepts, even without randomUUID", () => {
  assert.match(M.newId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("a network miss is a rejected fetch or an offline device, never a server answer", () => {
  assert.equal(M.isNetworkMiss(new TypeError("Failed to fetch"), true), true);
  assert.equal(M.isNetworkMiss(new Error("anything"), false), true);
  assert.equal(M.isNetworkMiss(new TypeError("x is not a function"), true), false);
  assert.equal(M.isNetworkMiss(Object.assign(new Error("bad"), { status: 400 }), true), false);
});

test("verdict keeps an item for a later try on a miss or a server fault, and drops it on a refusal", () => {
  assert.equal(M.verdict(new TypeError("Failed to fetch"), true), "later");
  assert.equal(M.verdict(Object.assign(new Error("x"), { status: 503 }), true), "later");
  assert.equal(M.verdict(Object.assign(new Error("x"), { status: 429 }), true), "later");
  assert.equal(M.verdict(new Error("Signed out."), true), "later");
  assert.equal(M.verdict(Object.assign(new Error("x"), { status: 400 }), true), "drop");
  assert.equal(M.verdict(Object.assign(new Error("x"), { status: 409 }), true), "drop");
});

test("creates queue in order, and the same id twice is one item", () => {
  let items = M.enqueueCreate([], values(ID_A, "first"), 0, NOW);
  items = M.enqueueCreate(items, values(ID_B, "second"), 1, NOW);
  assert.deepEqual(items.map((item) => item.id), [ID_A, ID_B]);
  assert.ok(items[1]!.order > items[0]!.order);
  items = M.enqueueCreate(items, values(ID_A, "first again"), 0, NOW);
  assert.equal(items.length, 2);
  assert.equal(items[0]!.body.title, "first again");
  assert.equal(items[0]!.rev, 1);
});

test("an edit of a queued create goes into the create, and indent stays beside the body", () => {
  let items = M.enqueueCreate([], values(ID_A, "first"), 0, NOW);
  items = M.enqueueUpdate(items, ID_A, { title: "renamed", indent: 1 }, NOW);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.kind, "create");
  assert.equal(items[0]!.body.title, "renamed");
  assert.equal("indent" in items[0]!.body, false);
  assert.equal(items[0]!.indent, 1);
});

test("changes to a saved entry join one update item", () => {
  let items = M.enqueueUpdate([], ID_A, { title: "a" }, NOW);
  items = M.enqueueUpdate(items, ID_A, { time: "09:00" }, NOW);
  assert.equal(items.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(items[0]!.body)), { title: "a", time: "09:00" });
});

test("afterSent drops a sent item, and keeps a change made in flight as an update", () => {
  const items = M.enqueueCreate([], values(ID_A, "first"), 0, NOW);
  assert.deepEqual(M.afterSent(items, items[0]!), []);

  const edited = M.enqueueUpdate(items, ID_A, { title: "edited meanwhile" }, NOW);
  const rest = M.afterSent(edited, items[0]!);
  assert.equal(rest.length, 1);
  assert.equal(rest[0]!.kind, "update");
  assert.equal(rest[0]!.key, `u:${ID_A}`);
  assert.deepEqual(JSON.parse(JSON.stringify(rest[0]!.body)), { date: "2026-11-22", type: "task", title: "edited meanwhile", tags: [], time: null });
});

test("merge adds queued creates at the end of their day, marked queued", () => {
  const base = [saved("s1", "saved one", 0), saved("s2", "saved two", 1)];
  const items = M.enqueueCreate([], values(ID_A, "queued"), 1, NOW);
  const shown = M.merge(base, items);
  assert.deepEqual(shown.map((entry) => entry.title), ["saved one", "saved two", "queued"]);
  assert.equal(shown[2]!.queued, "create");
  assert.equal(shown[2]!.position, 2);
  assert.equal(shown[2]!.indent, 1);
  assert.equal(shown[0]!.queued, undefined);
});

test("merge joins by id: once the server has the entry, the queued copy does not show twice", () => {
  const items = M.enqueueCreate([], values(ID_A, "queued"), 0, NOW);
  const shown = M.merge([saved(ID_A, "queued", 0)], items);
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.queued, undefined);
});

test("merge applies queued changes to a saved entry and clears a stale queued mark", () => {
  const items = M.enqueueUpdate([], "s1", { title: "changed" }, NOW);
  const shown = M.merge([saved("s1", "saved one", 0)], items);
  assert.equal(shown[0]!.title, "changed");
  assert.equal(shown[0]!.queued, "update");
  const stale = M.merge(shown, []);
  assert.equal(stale[0]!.queued, undefined);
});

test("merge drops an entry that stood for a queued create whose item is gone", () => {
  const items = M.enqueueCreate([], values(ID_A, "queued"), 0, NOW);
  const shown = M.merge([], items);
  assert.equal(M.merge(shown, []).length, 0);
});

test("preview shows a queued create as its item, and a saved entry with its queued changes", () => {
  const items = M.enqueueCreate([], values(ID_A, "queued"), 0, NOW);
  const entry = M.preview(saved(ID_A, "old", 3), items);
  assert.equal(entry.title, "queued");
  assert.equal(entry.position, 3);
  assert.equal(entry.queued, "create");
});
