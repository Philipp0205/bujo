import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Stroke = { d: string; width: number };
type Strokes = { viewBox: string; strokes: Stroke[] } | null;
type Model = { TYPES: string[]; strokes: (type: string, seed: string) => Strokes };

/** The browser files, loaded the way a page loads them: scripts that hang themselves on window.BujoLog. */
function loadModel(): Model {
  const window: { BujoLog?: { ink: { bulletModel: Model } } } = {};
  for (const file of ["scan/scribble.js", "ink/bullet-model.js"]) {
    vm.runInNewContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), { window, Math, Object, String });
  }
  return window.BujoLog!.ink.bulletModel;
}

const model = loadModel();

test("every bullet type has strokes", () => {
  assert.deepEqual([...model.TYPES].sort(), ["dropped", "done", "event", "migrated", "note", "scheduled", "task"].sort());
  for (const type of model.TYPES) {
    const result = model.strokes(type, "abc")!;
    assert.ok(result.strokes.length >= 1, type);
    for (const stroke of result.strokes) assert.match(stroke.d, /^M/);
  }
});

test("the x and the chevrons are drawn in two strokes, the rest in one or two", () => {
  assert.equal(model.strokes("done", "a")!.strokes.length, 2);
  assert.equal(model.strokes("migrated", "a")!.strokes.length, 2);
  assert.equal(model.strokes("scheduled", "a")!.strokes.length, 2);
  assert.equal(model.strokes("event", "a")!.strokes.length, 1);
});

test("the same type and seed give the same strokes", () => {
  for (const type of model.TYPES) assert.deepEqual(model.strokes(type, "id-1"), model.strokes(type, "id-1"));
});

test("a different seed wobbles differently", () => {
  for (const type of model.TYPES) assert.notDeepEqual(model.strokes(type, "id-1"), model.strokes(type, "id-2"), type);
});

test("stroke widths stay within a pen's range", () => {
  for (const type of model.TYPES) {
    for (const stroke of model.strokes(type, "w")!.strokes) assert.ok(stroke.width >= 1 && stroke.width <= 4.2, `${type} ${stroke.width}`);
  }
});

test("the dropped bullet is a dot with one diagonal slash through its middle", () => {
  for (const seed of ["a", "b", "c"]) {
    const { strokes } = model.strokes("dropped", seed)!;
    assert.equal(strokes.length, 2);
    const [slash] = strokes.slice(1).map((stroke) => stroke.d.match(/-?\d+(\.\d+)?/g)!.map(Number));
    const xs = slash.filter((_, index) => index % 2 === 0);
    const ys = slash.filter((_, index) => index % 2 === 1);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 8) < 0.7, "centred across");
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 8) < 0.7, "centred down");
    assert.ok(xs[0] < xs[xs.length - 1] && ys[0] > ys[ys.length - 1], "runs from lower left to upper right");
  }
});

test("an unknown type has no bullet", () => {
  assert.equal(model.strokes("nope", "a"), null);
});
