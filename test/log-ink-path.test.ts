import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Stroke = { d: string; width: number; opacity: number };
type RectOptions = { radius: number; scale?: number; openBottom?: boolean };
type InkPath = {
  rect: (w: number, h: number, seed: string, options: RectOptions) => Stroke[];
  line: (w: number, seed: string, kind: "underline" | "handle" | "rule") => Stroke[];
};

/** The browser generator, loaded the way a page loads it: a script that hangs itself on window.BujoLog.ink. */
function loadPath(): InkPath {
  const window: { BujoLog?: { ink: { path: InkPath } } } = {};
  const source = readFileSync(new URL("../public/js/log/ink/path.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window, Math });
  return window.BujoLog!.ink.path;
}

const path = loadPath();
const CARD = { radius: 16, scale: 1 };

test("a rounded rect is deterministic: the same seed and size give the same path", () => {
  assert.deepEqual(path.rect(340, 80, "card|abc", CARD), path.rect(340, 80, "card|abc", CARD));
});

test("a different seed gives a different path, and a different size too", () => {
  const base = path.rect(340, 80, "card|abc", CARD)[0].d;
  assert.notEqual(path.rect(340, 80, "card|xyz", CARD)[0].d, base);
  assert.notEqual(path.rect(340, 96, "card|abc", CARD)[0].d, base);
});

test("a closed card path is a usable SVG d: starts with M, has curves and lines, only finite numbers", () => {
  const [main, faint] = path.rect(340, 80, "card|abc", CARD);
  for (const stroke of [main, faint]) {
    assert.match(stroke.d, /^M-?\d/);
    assert.match(stroke.d, /Q/);
    assert.match(stroke.d, /L-?\d/);
    assert.match(stroke.d, /^[MQL0-9.\- ]+$/);
  }
  assert.equal(main.width, 1.12);
  assert.equal(main.opacity, 1);
  assert.equal(faint.width, 0.82);
  assert.equal(faint.opacity, 0.32);
});

test("the pen stays inside the box, give or take the wobble", () => {
  const numbers = path.rect(340, 80, "card|abc", CARD)[0].d.match(/-?\d+\.\d+/g)!.map(Number);
  assert.ok(numbers.length > 40);
  assert.ok(numbers.every((n) => n > -3 && n < 343));
});

test("an open bottom (the sheet) does not close its path and still starts with M", () => {
  const [main] = path.rect(390, 200, "sheet", { radius: 22, scale: 1.25, openBottom: true });
  assert.match(main.d, /^M/);
  assert.match(main.d, /L/);
});

test("a pill outline works at a small size with a half-height radius", () => {
  const [main] = path.rect(60, 20, "pill|a|tag|health", { radius: 10, scale: 0.5 });
  assert.match(main.d, /^M/);
  assert.match(main.d, /Q/);
});

test("lines: underline, handle and rule are deterministic open paths, and the seed changes them", () => {
  for (const kind of ["underline", "handle", "rule"] as const) {
    const a = path.line(40, "seed", kind);
    assert.deepEqual(a, path.line(40, "seed", kind));
    assert.notDeepEqual(a, path.line(40, "other", kind));
    assert.match(a[0].d, /^M/);
    assert.match(a[0].d, /L/);
  }
});

test("an underline has a faint second pass, a handle is one thick stroke", () => {
  assert.equal(path.line(40, "today", "underline").length, 2);
  const handle = path.line(40, "handle", "handle");
  assert.equal(handle.length, 1);
  assert.ok(handle[0].width > 2);
});
