import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

type Cell = { number: number; scanned: boolean; item?: { number: number } };
type Model = {
  pageStatus(pages: unknown[], pageCount: number): Cell[];
  scannedCount(status: Cell[]): number;
  sections(pages: unknown[]): { daily: unknown[]; month: unknown[]; future: unknown[] };
  dateLabel(iso: string): string;
  datesOf(notebook: { startedOn: string; endedOn: string | null }): string;
  suggestedName(list: unknown[]): string;
  parsePages(text: string): { ok: boolean; value?: number };
};

/** Loads public/js/notebooks/copy.js and model.js into a sandbox (with the month names the index copy would give). */
function loadModel(): Model {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const window: Record<string, any> = {
    BujoIndex: { copy: { shortMonth: (month: string) => `${months[Number(month.slice(5, 7)) - 1].slice(0, 3)} ${month.slice(0, 4)}` } },
  };
  const read = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "public", "js", "notebooks", name), "utf8");
  vm.runInNewContext(read("copy.js"), { window });
  vm.runInNewContext(read("model.js"), { window });
  return window.BujoNotebooks.model;
}

test("client pageStatus: numbers 1..pageCount, scanned ones carry their page, the first of a number wins", () => {
  const model = loadModel();
  const pages = [{ number: 2, kind: "day", ref: "2026-11-18" }, { number: 2, kind: "month", ref: "2026-11" }, { number: 4, kind: "future", ref: "2027-01" }, { number: 99, kind: "day", ref: "x" }];
  const status = model.pageStatus(pages, 4);
  assert.deepEqual([...status].map((cell) => [cell.number, cell.scanned]), [[1, false], [2, true], [3, false], [4, true]]);
  assert.equal(status[1].item, pages[0]);
  assert.equal(status[0].item, undefined);
  assert.equal(model.scannedCount(status), 2);
  assert.equal(model.pageStatus([], 0).length, 0);
});

test("sections split the pages by kind and leave collections out", () => {
  const sections = loadModel().sections([{ kind: "day" }, { kind: "collection" }, { kind: "future" }, { kind: "month" }, { kind: "day" }]);
  assert.deepEqual([sections.daily.length, sections.month.length, sections.future.length], [2, 1, 1]);
});

test("dates read as 20 Nov 2026, since while active, a range once ended", () => {
  const model = loadModel();
  assert.equal(model.dateLabel("2026-11-20"), "20 Nov 2026");
  assert.equal(model.datesOf({ startedOn: "2026-11-05", endedOn: null }), "Since 5 Nov 2026");
  assert.equal(model.datesOf({ startedOn: "2026-11-05", endedOn: "2027-03-03" }), "5 Nov 2026 to 3 Mar 2027");
});

test("the form: the suggested name counts on, pages are a whole number 1..9999", () => {
  const model = loadModel();
  assert.equal(model.suggestedName([{}, {}]), "Notebook 3");
  for (const [text, ok] of [["100", true], [" 7 ", true], ["9999", true], ["0", false], ["10000", false], ["1.5", false], ["", false], ["ab", false], ["-3", false]] as const) {
    assert.equal(model.parsePages(text).ok, ok, text);
  }
  assert.equal(model.parsePages("120").value, 120);
});
