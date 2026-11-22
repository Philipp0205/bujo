import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const TODAY = "2026-11-22";

/** Loads public/js/log/paper/recent.js and public/js/notes/model.js into a sandbox and returns what the model adds to window.BujoNotes. */
function loadModel(): { cards(entries: unknown[], today: string): any[]; groups(cards: any[]): any[] } {
  const window: Record<string, any> = {};
  const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
  window.BujoLog = { dates: { addDays } };
  const read = (...parts: string[]) => fs.readFileSync(path.join(import.meta.dirname, "..", "public", "js", ...parts), "utf8");
  vm.runInNewContext(read("log", "paper", "recent.js"), { window });
  vm.runInNewContext(read("notes", "model.js"), { window });
  return window.BujoNotes.model;
}

test("cards: one per note with its title, whether a photo is stored, and no notebook yet", () => {
  const model = loadModel();
  const cards = model.cards([
    { id: "a", title: "Kitchen garden", hasPhoto: true, body: "x", date: TODAY, onPaper: true },
    { id: "b", title: "Weekend notes", hasPhoto: false, body: "y", date: TODAY, onPaper: false },
  ], TODAY);
  assert.deepEqual(JSON.parse(JSON.stringify(cards)), [
    { id: "a", title: "Kitchen garden", hasPhoto: true, notebookId: null, onPaper: true, date: TODAY, unwritten: false },
    { id: "b", title: "Weekend notes", hasPhoto: false, notebookId: null, onPaper: false, date: TODAY, unwritten: true },
  ]);
});

test("cards: the mark needs not-on-paper and a day inside the 14 day window; future notes keep it", () => {
  const model = loadModel();
  const note = (id: string, date: string, onPaper: boolean) => ({ id, title: id, date, onPaper });
  const cards = model.cards([
    note("edge", "2026-11-08", false),
    note("old", "2026-11-07", false),
    note("future", "2026-12-01", false),
    note("written", TODAY, true),
  ], TODAY);
  assert.deepEqual(cards.map((card) => [card.id, card.unwritten]), [["edge", true], ["old", false], ["future", true], ["written", false]]);
});

test("groups: without notebooks every card lands in one group, in the order given", () => {
  const model = loadModel();
  const groups = model.groups(model.cards([{ id: "a", title: "A" }, { id: "b", title: "B" }], TODAY));
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
