import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { PUBLIC_DIR } from "../src/app.ts";

type Sandbox = {
  attrs: Map<string, string>;
  store: Map<string, string>;
  theme: { read(): string; apply(c: string): void; choose(c: string): string; choices: string[] };
  pageshow(): void;
};

/** Runs the real public/js/theme/boot.js in a page-like sandbox with a fake <html> and localStorage. */
function boot(options: { saved?: string; storageThrows?: boolean } = {}): Sandbox {
  const attrs = new Map<string, string>();
  const store = new Map<string, string>();
  if (options.saved !== undefined) store.set("bujo-theme", options.saved);
  const listeners: Record<string, () => void> = {};
  const sandbox: Record<string, any> = {
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => void attrs.set(name, value),
        removeAttribute: (name: string) => void attrs.delete(name),
      },
    },
    localStorage: {
      getItem: (key: string) => {
        if (options.storageThrows) throw new Error("blocked");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (options.storageThrows) throw new Error("blocked");
        store.set(key, value);
      },
    },
    addEventListener: (name: string, fn: () => void) => void (listeners[name] = fn),
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "js/theme/boot.js"), "utf8"), sandbox);
  return { attrs, store, theme: sandbox.BujoTheme, pageshow: () => listeners.pageshow() };
}

test("a saved light or dark choice is forced on <html> at boot", () => {
  assert.equal(boot({ saved: "light" }).attrs.get("data-ak-scheme"), "light");
  assert.equal(boot({ saved: "dark" }).attrs.get("data-ak-scheme"), "dark");
});

test("nothing saved, system, or an invalid value leaves the OS preference in charge", () => {
  for (const saved of [undefined, "system", "sepia", ""]) {
    const page = boot({ saved });
    assert.equal(page.attrs.has("data-ak-scheme"), false, `saved=${String(saved)}`);
    assert.equal(page.theme.read(), "system");
  }
});

test("a blocked storage means system, and choosing still applies for this page", () => {
  const page = boot({ storageThrows: true });
  assert.equal(page.theme.read(), "system");
  assert.equal(page.theme.choose("dark"), "dark");
  assert.equal(page.attrs.get("data-ak-scheme"), "dark");
});

test("choose saves the value, applies it, and system removes the override", () => {
  const page = boot({ saved: "light" });
  page.theme.choose("dark");
  assert.equal(page.store.get("bujo-theme"), "dark");
  assert.equal(page.attrs.get("data-ak-scheme"), "dark");
  page.theme.choose("system");
  assert.equal(page.store.get("bujo-theme"), "system");
  assert.equal(page.attrs.has("data-ak-scheme"), false);
});

test("choose turns an unknown value into system", () => {
  const page = boot();
  assert.equal(page.theme.choose("neon"), "system");
  assert.equal(page.store.get("bujo-theme"), "system");
});

test("a page restored from the back-forward cache applies the saved choice again", () => {
  const page = boot({ saved: "light" });
  page.store.set("bujo-theme", "dark");
  page.pageshow();
  assert.equal(page.attrs.get("data-ak-scheme"), "dark");
});
