import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Stroke = { d: string; width: number; opacity: number };
type Ink = {
  path: { box: (seed: string) => Stroke[]; tick: (seed: string) => Stroke[] };
  button: { outlineSvg: (w: number, h: number, seed: string) => string };
};

/** The browser scripts, loaded the way a page loads them: path.js first, then button.js, both hanging on window.BujoLog.ink. */
function loadInk(): Ink {
  const window: { BujoLog?: { ink: Ink } } = {};
  for (const file of ["path", "button"]) {
    const source = readFileSync(new URL(`../public/js/log/ink/${file}.js`, import.meta.url), "utf8");
    vm.runInNewContext(source, { window, Math });
  }
  return window.BujoLog!.ink;
}

const ink = loadInk();

/** Every number in a path string. */
const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

test("a tick box is deterministic: the same seed gives the same box and tick, another seed another wobble", () => {
  assert.deepEqual(ink.path.box("row-1"), ink.path.box("row-1"));
  assert.deepEqual(ink.path.tick("row-1"), ink.path.tick("row-1"));
  assert.notDeepEqual(ink.path.box("row-1"), ink.path.box("row-2"));
  assert.notDeepEqual(ink.path.tick("row-1"), ink.path.tick("row-2"));
});

test("a tick box is a closed pen square with a faint second pass, inside the 24 by 24 box", () => {
  const [main, faint] = ink.path.box("row-1");
  assert.match(main.d, /^M-?\d/);
  assert.match(main.d, /Q/);
  assert.ok(faint.opacity < main.opacity);
  assert.ok(numbers(main.d).every((n) => n > -1 && n < 25));
});

test("a pen tick is an open stroke that goes down short and up long, with a faint redraw, and stays finite", () => {
  const [main, faint] = ink.path.tick("row-1");
  assert.match(main.d, /^M/);
  assert.ok(main.width > 1.5);
  assert.ok(faint.opacity < 0.5);
  const all = numbers(main.d);
  assert.ok(all.length > 8 && all.every(Number.isFinite));
  assert.ok(all.every((n) => n > -1 && n < 25));
});

test("the ink button outline is an svg of the asked size with the same paths for the same seed", () => {
  const svg = ink.button.outlineSvg(340, 48, "apply");
  assert.match(svg, /^<svg [^>]*width="340" height="48" viewBox="0 0 340 48">/);
  assert.equal(svg, ink.button.outlineSvg(340, 48, "apply"));
  assert.notEqual(svg, ink.button.outlineSvg(340, 48, "save"));
  assert.equal((svg.match(/<path /g) ?? []).length, 2);
  assert.doesNotMatch(svg, /currentColor|var\(/);
});
