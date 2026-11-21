import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

/** Loads public/js/notes/model.js into a sandbox and returns what it adds to window.BujoNotes. */
function loadModel(): { cards(entries: unknown[]): any[]; groups(cards: any[]): any[] } {
  const window: Record<string, any> = {};
  const source = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "js", "notes", "model.js"), "utf8");
  vm.runInNewContext(source, { window });
  return window.BujoNotes.model;
}

test("cards: one per note with its title, whether a photo is stored, and no notebook yet", () => {
  const model = loadModel();
  const cards = model.cards([
    { id: "a", title: "Kitchen garden", hasPhoto: true, body: "x" },
    { id: "b", title: "Weekend notes", hasPhoto: false, body: "y" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(cards)), [
    { id: "a", title: "Kitchen garden", hasPhoto: true, notebookId: null },
    { id: "b", title: "Weekend notes", hasPhoto: false, notebookId: null },
  ]);
});

test("groups: without notebooks every card lands in one group, in the order given", () => {
  const model = loadModel();
  const groups = model.groups(model.cards([{ id: "a", title: "A" }, { id: "b", title: "B" }]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].notebookId, null);
  assert.deepEqual([...groups[0].cards.map((card: { id: string }) => card.id)], ["a", "b"]);
});

test("groups: cards of a notebook form a group of their own, after the cards that belong to none", () => {
  const model = loadModel();
  const groups = model.groups([
    { id: "a", title: "A", hasPhoto: false, notebookId: "nb1" },
    { id: "b", title: "B", hasPhoto: false, notebookId: null },
    { id: "c", title: "C", hasPhoto: false, notebookId: "nb1" },
  ]);
  assert.deepEqual([...groups.map((group: { notebookId: string | null }) => group.notebookId)], [null, "nb1"]);
  assert.deepEqual([...groups[1].cards.map((card: { id: string }) => card.id)], ["a", "c"]);
});
