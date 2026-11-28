import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const FILE = path.join(import.meta.dirname, "..", "public", "js", "log", "radial", "model.js");

type Layout = { cx: number; cy: number; items: Array<{ dx: number; dy: number }> };
type Model = {
  actionsFor(entry: { type: string }): string[];
  layout(count: number, at: { x: number; y: number }, viewport: { width: number; height: number }, options?: object): Layout;
  blobPath(seed: number, r: number): string;
  DEFAULTS: { radius: number; bubble: number; side: number; top: number; bottom: number };
};

/** Loads public/js/log/radial/model.js into a sandbox and returns the model. */
function loadModel(): Model {
  const window: Record<string, any> = {};
  vm.runInNewContext(fs.readFileSync(FILE, "utf8"), { window, Math });
  return window.BujoLog.radial.model;
}

const PHONE = { width: 390, height: 844 };

test("radial model: an open task offers done, migrate, schedule, edit, type and select", () => {
  assert.deepEqual(loadModel().actionsFor({ type: "task" }), ["done", "migrate", "schedule", "edit", "type", "select"]);
});

test("radial model: the other types offer only what applies to them", () => {
  const model = loadModel();
  assert.deepEqual(model.actionsFor({ type: "done" }), ["done", "edit", "type", "drop", "select"]);
  assert.deepEqual(model.actionsFor({ type: "note" }), ["edit", "type", "drop", "select"]);
  assert.deepEqual(model.actionsFor({ type: "event" }), ["edit", "type", "drop", "select"]);
  assert.deepEqual(model.actionsFor({ type: "dropped" }), ["edit", "type", "select"]);
});

test("radial model: the first bubble sits straight above the centre and the rest follow clockwise", () => {
  const { items } = loadModel().layout(4, { x: 195, y: 400 }, PHONE);
  assert.deepEqual(items[0], { dx: 0, dy: -92 });
  assert.deepEqual(items[1], { dx: 92, dy: 0 });
  assert.deepEqual(items[2], { dx: 0, dy: 92 });
  assert.deepEqual(items[3], { dx: -92, dy: 0 });
});

test("radial model: every bubble is the same distance from the centre", () => {
  const { items } = loadModel().layout(6, { x: 195, y: 400 }, PHONE);
  assert.equal(items.length, 6);
  for (const item of items) assert.ok(Math.abs(Math.hypot(item.dx, item.dy) - 92) < 0.1);
});

test("radial model: a press in the middle keeps the ring centred on it", () => {
  const ring = loadModel().layout(6, { x: 195, y: 420 }, PHONE);
  assert.equal(ring.cx, 195);
  assert.equal(ring.cy, 420);
});

test("radial model: the ring is kept clear of the sides, the top bar and the dock", () => {
  const model = loadModel();
  const { radius, bubble, side, top, bottom } = model.DEFAULTS;
  const extent = radius + bubble / 2;
  const left = model.layout(6, { x: 2, y: 420 }, PHONE);
  const right = model.layout(6, { x: 389, y: 420 }, PHONE);
  const high = model.layout(6, { x: 195, y: 10 }, PHONE);
  const low = model.layout(6, { x: 195, y: 840 }, PHONE);
  assert.equal(left.cx, extent + side);
  assert.equal(right.cx, PHONE.width - extent - side);
  assert.equal(high.cy, top + extent);
  assert.equal(low.cy, PHONE.height - bottom - extent);
});

test("radial model: every bubble of a clamped ring lies inside the screen", () => {
  const model = loadModel();
  const half = model.DEFAULTS.bubble / 2;
  for (const at of [{ x: 0, y: 0 }, { x: 390, y: 0 }, { x: 0, y: 844 }, { x: 390, y: 844 }]) {
    const ring = model.layout(6, at, PHONE);
    for (const item of ring.items) {
      assert.ok(ring.cx + item.dx - half >= 0 && ring.cx + item.dx + half <= PHONE.width);
      assert.ok(ring.cy + item.dy - half >= 0 && ring.cy + item.dy + half <= PHONE.height - model.DEFAULTS.bottom);
    }
  }
});

test("radial model: a screen too small for the ring centres it", () => {
  const ring = loadModel().layout(4, { x: 10, y: 10 }, { width: 200, height: 300 });
  assert.equal(ring.cx, 100);
  assert.equal(ring.cy, (56 + (300 - 88)) / 2);
});

test("radial model: the same seed draws the same wobbly circle and another seed another one", () => {
  const model = loadModel();
  assert.equal(model.blobPath(3, 30), model.blobPath(3, 30));
  assert.notEqual(model.blobPath(3, 30), model.blobPath(4, 30));
  assert.match(model.blobPath(3, 30), /^M[-\d. ]+( Q[-\d. ]+){10} Z$/);
});

test("radial model: the wobble stays close to a true circle", () => {
  const path = loadModel().blobPath(7, 30);
  const numbers = (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  for (let index = 0; index < numbers.length; index += 2) assert.ok(Math.hypot(numbers[index], numbers[index + 1]) < 30 * 1.15);
});
