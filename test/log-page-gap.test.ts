import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Gap = {
  model: { missing(known: number[], added: number, skipped?: number[]): number[]; ranges(numbers: number[]): number[][] };
  store: { list(): number[]; skip(numbers: number[]): void };
};
type Words = { pagesText(runs: number[][]): string; reminder(runs: number[][]): string; hint(runs: number[][]): string };

/** The real gap model, store and copy in a page-like sandbox with a fake localStorage (or one that always throws). */
function load(options: { saved?: string; blocked?: boolean } = {}): { gap: Gap; words: Words; data: Map<string, string> } {
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
  const window: { BujoLog: { gap?: Gap; copy: { gap?: Words } }; localStorage: typeof localStorage } = { BujoLog: { copy: {} }, localStorage };
  const context = vm.createContext({ window, String, Math, JSON, Array, Number });
  for (const file of ["gap/model.js", "gap/store.js", "gap/copy.js"]) {
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

test("skips are kept ascending and unique, and blocked or damaged storage never throws", () => {
  const first = load();
  first.gap.store.skip([9, 7]);
  first.gap.store.skip([7, 8]);
  assert.deepEqual(plain(first.gap.store.list()), [7, 8, 9]);
  assert.equal(first.data.get("bujo-page-gap-skipped"), "[7,8,9]");
  assert.deepEqual(plain(load({ saved: "not json" }).gap.store.list()), []);
  assert.deepEqual(plain(load({ saved: '{"a":1}' }).gap.store.list()), []);
  const blocked = load({ blocked: true });
  blocked.gap.store.skip([3]);
  assert.deepEqual(plain(blocked.gap.store.list()), []);
});
