import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");

/** Loads public/js/log/days.js and done/model.js into a sandbox and returns what the latter adds to window.BujoLog.done. */
function loadModel(): { next(type: string): string | null; canToggle(entry: { type: string }): boolean } {
  const window: Record<string, any> = {};
  for (const file of ["days.js", path.join("done", "model.js")]) {
    vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "js", "log", file), "utf8"), { window });
  }
  return window.BujoLog.done.model;
}

test("done model: a task becomes done and a done entry becomes a task", () => {
  const model = loadModel();
  assert.equal(model.next("task"), "done");
  assert.equal(model.next("done"), "task");
});

test("done model: event, note, moved and scheduled never toggle, and neither does an unknown type", () => {
  const model = loadModel();
  for (const type of ["event", "note", "moved", "scheduled", "toString", "constructor", ""]) {
    assert.equal(model.next(type), null, type);
    assert.equal(model.canToggle({ type }), false, type);
  }
  assert.equal(model.canToggle({ type: "task" }), true);
  assert.equal(model.canToggle({ type: "done" }), true);
});

test("done model: a day or calendar entry toggles, a month-task or future item never does", () => {
  const model = loadModel();
  assert.equal(model.canToggle({ type: "task", horizon: "day" } as { type: string }), true);
  assert.equal(model.canToggle({ type: "task", horizon: "month-calendar" } as { type: string }), true);
  assert.equal(model.canToggle({ type: "task", horizon: "month-task" } as { type: string }), false);
  assert.equal(model.canToggle({ type: "done", horizon: "future" } as { type: string }), false);
});
