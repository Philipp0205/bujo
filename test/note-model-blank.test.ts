import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

type Values = { id: string | null; title: string; date: string; body: string; hasPhoto: boolean };
type Model = { blank(date: string): Values; problem(values: Values): string; payload(values: Values): Record<string, unknown> };

/** Loads public/js/log/note/model.js the way a page does: it hangs itself on window.BujoLog. */
function loadModel(): Model {
  const window: Record<string, any> = {};
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "js", "log", "note", "model.js"), "utf8");
  vm.runInNewContext(source, { window });
  return window.BujoLog.note.model;
}

test("blank: a collection written from scratch has no id, title or text, and the given day", () => {
  const model = loadModel();
  const values = model.blank("2026-11-23");
  assert.deepEqual(JSON.parse(JSON.stringify(values)), { id: null, title: "", date: "2026-11-23", body: "", hasPhoto: false });
  assert.equal(model.problem(values), "title");
  assert.equal(model.problem({ ...values, title: "Camping" }), "body");
  assert.equal(model.problem({ ...values, title: "Camping", body: "- Zelt" }), "");
});

test("a blank collection is sent as a new note entry on its day", () => {
  const model = loadModel();
  const values = { ...model.blank("2026-11-23"), title: "  Camping ", body: "- Zelt" };
  assert.deepEqual(JSON.parse(JSON.stringify(model.payload(values))), { date: "2026-11-23", title: "Camping", body: "- Zelt", type: "note" });
});
