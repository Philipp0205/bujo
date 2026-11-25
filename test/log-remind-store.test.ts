import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Store = {
  monthlyDue(today: string): boolean;
  futureDue(today: string): boolean;
  dismissMonthly(today: string): void;
  dismissFuture(today: string): void;
};

/** The real remind/store.js in a page-like sandbox with a fake localStorage (or one that always throws). */
function load(options: { saved?: Record<string, string>; blocked?: boolean } = {}): { store: Store; data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(options.saved ?? {}));
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
  const window: { BujoLog?: { remind: { store: Store } }; localStorage: typeof localStorage } = { localStorage };
  const context = vm.createContext({ window, String });
  vm.runInContext(readFileSync(new URL("../public/js/log/remind/store.js", import.meta.url), "utf8"), context);
  return { store: window.BujoLog!.remind.store, data };
}

test("both nudges show when nothing is stored", () => {
  const { store } = load();
  assert.equal(store.monthlyDue("2026-11-25"), true);
  assert.equal(store.futureDue("2026-11-25"), true);
});

test("the monthly nudge hides for the stored day and shows again the next day", () => {
  const { store } = load({ saved: { "bujo-remind-month": "2026-11-25" } });
  assert.equal(store.monthlyDue("2026-11-25"), false);
  assert.equal(store.monthlyDue("2026-11-26"), true);
});

test("the future nudge hides for the stored month, on any day of it, and shows again in the next month", () => {
  const { store } = load({ saved: { "bujo-remind-future": "2026-11" } });
  assert.equal(store.futureDue("2026-11-02"), false);
  assert.equal(store.futureDue("2026-11-30"), false);
  assert.equal(store.futureDue("2026-12-01"), true);
});

test("a dismissal is stored as the day or the month and hides the nudge", () => {
  const { store, data } = load();
  store.dismissMonthly("2026-11-25");
  store.dismissFuture("2026-11-25");
  assert.equal(data.get("bujo-remind-month"), "2026-11-25");
  assert.equal(data.get("bujo-remind-future"), "2026-11");
  assert.equal(store.monthlyDue("2026-11-25"), false);
  assert.equal(store.futureDue("2026-11-25"), false);
});

test("blocked storage never throws: the nudges simply show", () => {
  const { store } = load({ blocked: true });
  assert.doesNotThrow(() => store.dismissMonthly("2026-11-25"));
  assert.doesNotThrow(() => store.dismissFuture("2026-11-25"));
  assert.equal(store.monthlyDue("2026-11-25"), true);
  assert.equal(store.futureDue("2026-11-25"), true);
});
