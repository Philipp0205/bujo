import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Gap = {
  model: { missing(known: number[], added: number, skipped?: number[]): number[]; ranges(numbers: number[]): number[][] };
  store: { list(id: string, first: boolean): number[]; skip(id: string, first: boolean, numbers: number[]): void };
  scope: { pick(notebooks: unknown[]): { id: string; first: boolean } | null; load(): Promise<{ id: string; first: boolean; numbers: number[] } | null> };
};
type Words = { pagesText(runs: number[][]): string; reminder(runs: number[][]): string; hint(runs: number[][]): string };
type Api = { listNotebooks(): Promise<unknown[]>; getNotebook(id: string): Promise<{ pages: Array<{ number: number }> }> };

/** The real gap model, store, scope and copy in a page-like sandbox with a fake localStorage (or one that always throws) and a fake notebooks api. */
function load(options: { saved?: string; blocked?: boolean; api?: Api } = {}): { gap: Gap; words: Words; data: Map<string, string> } {
  const data = new Map<string, string>();
  if (options.saved !== undefined) data.set("bujo-page-gap-skipped", options.saved);
  const localStorage = {
    getItem: (key: string) => {
      if (options.blocked) throw new Error("blocked");
      return data.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (options.blocked) throw new Error("blocked");
      data.set(key, value);
    },
  };
  const window: { BujoLog: { gap?: Gap; copy: { gap?: Words }; api?: Api }; localStorage: typeof localStorage } = { BujoLog: { copy: {}, api: options.api }, localStorage };
  const context = vm.createContext({ window, String, Math, JSON, Array, Number, Promise });
  for (const file of ["gap/model.js", "gap/store.js", "gap/scope.js", "gap/copy.js"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), context);
  }
  return { gap: window.BujoLog.gap!, words: window.BujoLog.copy.gap!, data };
}

const { gap: raw, words } = load();
/** Arrays made inside the sandbox have another Array prototype: copy them out so deepEqual compares plain values. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const gap = {
  model: {
    missing: (known: number[], added: number, skipped: number[] = []) => plain(raw.model.missing(known, added, skipped)),
    ranges: (numbers: number[]) => plain(raw.model.ranges(numbers)),
  },
};
const missing = gap.model.missing;

test("the first known page never asks for anything, even a high one", () => {
  assert.deepEqual(missing([], 5), []);
  assert.deepEqual(missing([], 1), []);
  assert.deepEqual(missing([], 9999), []);
});

test("the next consecutive page and anything at or under the frontier is silent", () => {
  assert.deepEqual(missing([4], 5), []);
  assert.deepEqual(missing([4], 4), []);
  assert.deepEqual(missing([4, 9], 3), []);
  assert.deepEqual(missing([4, 9], 10), []);
});

test("a jump lists the pages in between", () => {
  assert.deepEqual(missing([11], 14), [12, 13]);
  assert.deepEqual(missing([1], 3), [2]);
});

test("pages before the first known page are never returned", () => {
  assert.deepEqual(missing([5], 10), [6, 7, 8, 9]);
  assert.deepEqual(missing([5, 6], 10), [7, 8, 9]);
});

test("the highest known page counts, holes below it are not the concern", () => {
  assert.deepEqual(missing([3, 10], 13), [11, 12]);
});

test("the applied page is left out of the known pages, as the apply may have stored it already", () => {
  assert.deepEqual(missing([5, 10], 10), [6, 7, 8, 9]);
  assert.deepEqual(missing([5, 10], 7), []);
  assert.deepEqual(missing([5, 12], 12), [6, 7, 8, 9, 10, 11]);
  assert.deepEqual(missing([5, 8, 12], 12), [9, 10, 11]);
  assert.deepEqual(missing([12], 12), []);
});

test("several holes come out ascending", () => {
  assert.deepEqual(missing([10], 20, [13, 14, 15, 17]), [11, 12, 16, 18, 19]);
});

test("skipped numbers are omitted, and skipping everything gives nothing", () => {
  assert.deepEqual(missing([5], 10, [6, 7]), [8, 9]);
  assert.deepEqual(missing([5], 8, [6, 7]), []);
  assert.deepEqual(missing([5], 8, [1, 99, 7]), [6]);
});

test("a skipped page that was scanned later is known, and an unrelated skip changes nothing", () => {
  assert.deepEqual(missing([5, 6, 7], 9, [6, 7]), [8]);
  assert.deepEqual(missing([5], 8, [8]), [6, 7]);
});

test("the edges 1 and 9999", () => {
  assert.deepEqual(missing([1], 4), [2, 3]);
  assert.deepEqual(missing([9996], 9999), [9997, 9998]);
  assert.deepEqual(missing([1], 9999).length, 9997);
  assert.deepEqual(missing([9999], 9999), []);
});

test("invalid numbers are ignored", () => {
  assert.deepEqual(missing([5], 0), []);
  assert.deepEqual(missing([5], 10000), []);
  assert.deepEqual(missing([5], 7.5), []);
  assert.deepEqual(missing([0, -3, 5.5, 5], 8), [6, 7]);
  assert.deepEqual(missing([0, 5.5], 8), []);
});

test("ranges fold runs", () => {
  assert.deepEqual(gap.model.ranges([]), []);
  assert.deepEqual(gap.model.ranges([12]), [[12, 12]]);
  assert.deepEqual(gap.model.ranges([12, 13, 14, 16, 18]), [[12, 14], [16, 16], [18, 18]]);
});

test("compact range wording uses an en dash and plain English joins", () => {
  const text = (numbers: number[]) => words.pagesText(gap.model.ranges(numbers));
  assert.equal(text([12]), "page 12");
  assert.equal(text([12, 13, 14]), "pages 12\u201314");
  assert.equal(text([12, 13]), "pages 12\u201313");
  assert.equal(text([12, 14]), "pages 12 and 14");
  assert.equal(text([12, 13, 14, 16, 18]), "pages 12\u201314, 16 and 18");
  assert.equal(text([2, 4, 6, 7, 9]), "pages 2, 4, 6\u20137 and 9");
});

test("the reminder and hint never use an em dash", () => {
  for (const numbers of [[12], [12, 13, 14], [12, 14, 16]]) {
    const runs = gap.model.ranges(numbers);
    assert.ok(!words.reminder(runs).includes("\u2014"));
    assert.ok(!words.hint(runs).includes("\u2014"));
  }
  assert.equal(words.reminder(gap.model.ranges([12])), "Page 12 is not scanned yet.");
  assert.equal(words.reminder(gap.model.ranges([12, 13, 14, 16])), "Pages 12\u201314 and 16 are not scanned yet.");
});

test("skips are kept per notebook, ascending and unique, and blocked or damaged storage never throws", () => {
  const first = load();
  first.gap.store.skip("a", false, [9, 7]);
  first.gap.store.skip("a", false, [7, 8]);
  assert.deepEqual(plain(first.gap.store.list("a", false)), [7, 8, 9]);
  assert.equal(first.data.get("bujo-page-gap-skipped:a"), "[7,8,9]");
  assert.deepEqual(plain(load({ saved: "not json" }).gap.store.list("a", true)), []);
  assert.deepEqual(plain(load({ saved: '{"a":1}' }).gap.store.list("a", true)), []);
  const blocked = load({ blocked: true });
  blocked.gap.store.skip("a", true, [3]);
  assert.deepEqual(plain(blocked.gap.store.list("a", true)), []);
});

test("a skip in notebook A does not hide the gap in notebook B", () => {
  const { gap: loaded } = load();
  loaded.store.skip("a", false, [13, 14]);
  assert.deepEqual(plain(loaded.store.list("b", false)), []);
  assert.deepEqual(plain(loaded.model.missing([11], 15, loaded.store.list("b", false))), [12, 13, 14]);
  assert.deepEqual(plain(loaded.model.missing([11], 15, loaded.store.list("a", false))), [12]);
});

test("the old single key is the skip list of the first notebook only, until it has a key of its own", () => {
  const old = load({ saved: "[3,4]" });
  assert.deepEqual(plain(old.gap.store.list("a", true)), [3, 4]);
  assert.deepEqual(plain(old.gap.store.list("b", false)), []);
  old.gap.store.skip("a", true, [6]);
  assert.deepEqual(plain(old.gap.store.list("a", true)), [3, 4, 6], "nothing the old key held is lost");
  assert.equal(old.data.get("bujo-page-gap-skipped"), "[3,4]", "the old key is left as it was");
});

const book = (id: string, active: boolean, createdAt: number) => ({ id, active, createdAt });

test("scope: the active notebook, and whether it is the oldest one", () => {
  const { gap: loaded } = load();
  assert.deepEqual(plain(loaded.scope.pick([book("b", true, 20), book("a", false, 10)])), { id: "b", first: false });
  assert.deepEqual(plain(loaded.scope.pick([book("a", true, 10)])), { id: "a", first: true });
  assert.equal(loaded.scope.pick([book("a", false, 10)]), null);
});

test("scope: known pages come from the active notebook only, so an ended notebook's pages are ignored", async () => {
  const pages: Record<string, number[]> = { a: [1, 2, 3, 40], b: [1] };
  const api: Api = {
    listNotebooks: async () => [book("b", true, 20), book("a", false, 10)],
    getNotebook: async (id) => ({ pages: pages[id].map((number) => ({ number })) }),
  };
  const found = plain(await load({ api }).gap.scope.load());
  assert.deepEqual(found, { id: "b", first: false, numbers: [1] });
  const failing: Api = { listNotebooks: async () => { throw new Error("offline"); }, getNotebook: api.getNotebook };
  assert.equal(await load({ api: failing }).gap.scope.load(), null);
});
