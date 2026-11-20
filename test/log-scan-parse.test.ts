import assert from "node:assert/strict";
import test from "node:test";
import type { OcrLine } from "../src/scan/ocr-client.ts";
import type { Entry } from "../src/log/types.ts";
import { buildLogDraft, checkLines, startReview } from "../src/log/scan/draft.ts";
import { parseHeaderDate } from "../src/log/scan/header.ts";
import { parsePage } from "../src/log/scan/parse.ts";
import { resolveLines } from "../src/log/scan/resolve.ts";
import { line } from "./fake-ocr.ts";

const TODAY = "2026-11-20";

function entry(id: string, type: Entry["type"], title: string): Entry {
  return { id, date: TODAY, type, title, tag: null, time: null, sync: "local", syncError: null, position: 0, createdAt: 0, updatedAt: 0 };
}

test("header dates: full, year-less with a weekday, OCR noise, and what is no date", () => {
  assert.equal(parseHeaderDate("20.11.2026", TODAY), "2026-11-20");
  assert.equal(parseHeaderDate("20.11.", TODAY), "2026-11-20");
  assert.equal(parseHeaderDate("Friday 20.11", TODAY), "2026-11-20");
  assert.equal(parseHeaderDate("Freitag, 5.3.", "2027-01-01"), "2027-03-05");
  assert.equal(parseHeaderDate("2O.11.", TODAY), "2026-11-20");
  assert.equal(parseHeaderDate("31.02.", TODAY), null);
  assert.equal(parseHeaderDate("Milch kaufen", TODAY), null);
  assert.equal(parseHeaderDate("Call Mira 12", TODAY), null);
});

test("parsePage: bullets give types, the header is not an entry, ids follow the page order", () => {
  const page = parsePage(
    [
      line("none", "Friday 20.11", 0.8),
      line("•", "Tasche packen", 0.94),
      line("○", "Lunch with Mira", 0.71),
      line("–", "Library card", 0.63),
      line("x", "Plants", 0.91),
      line(">", "Umzug", 0.9),
      line("<", "Besuch", 0.9),
      line("none", "stray mark", 0.4),
    ],
    "2026-01-01",
  );
  assert.equal(page.pageDate, "2026-11-20");
  assert.deepEqual(page.lines.map((l) => [l.id, l.type]), [
    ["l2", "task"], ["l3", "event"], ["l4", "note"], ["l5", "done"], ["l6", "migrated"], ["l7", "scheduled"], ["l8", "note"],
  ]);
  assert.equal(page.lines.at(-1)?.noBullet, true);
  assert.equal(page.lines[0].noBullet, false);
});

test("parsePage: no header line means no page date", () => {
  const page = parsePage([line("•", "Milch kaufen")], TODAY);
  assert.equal(page.pageDate, null);
  assert.equal(page.lines.length, 1);
});

test("resolveLines: an x line completes one matching open task, a repeat is a duplicate, the rest is new", () => {
  const existing = [entry("e1", "task", "Water the office plants"), entry("e2", "note", "Idee Wochenende"), entry("e3", "done", "Schon erledigt")];
  const lines = [
    { id: "a", type: "done" as const, title: "water the office plants" },
    { id: "b", type: "done" as const, title: "Water the office plants" },
    { id: "c", type: "note" as const, title: "idee wochenende" },
    { id: "d", type: "task" as const, title: "Brot kaufen" },
    { id: "e", type: "done" as const, title: "Schon erledigt" },
  ];
  const out = resolveLines(lines, existing);
  assert.equal(out.get("a")?.status, "completes");
  assert.equal(out.get("a")?.target?.id, "e1");
  // The task is claimed by "a". "b" has no open task left, but the title exists, so it is a duplicate.
  assert.equal(out.get("b")?.status, "duplicate");
  assert.equal(out.get("c")?.status, "duplicate");
  assert.equal(out.get("d")?.status, "new");
  // An x line for a title that only exists as done is a duplicate, not a second completion.
  assert.equal(out.get("e")?.status, "duplicate");
});

test("resolveLines: only an x line completes a task, and an empty title matches nothing", () => {
  const existing = [entry("e1", "task", "Brot kaufen")];
  const out = resolveLines(
    [{ id: "a", type: "task", title: "Brot kaufen" }, { id: "b", type: "task", title: "" }],
    existing,
  );
  assert.equal(out.get("a")?.status, "duplicate");
  assert.equal(out.get("b")?.status, "new");
});

test("startReview: a new draft starts on the page date, bulletless and empty lines start off, duplicates start off", () => {
  const ocr = {
    lines: [
      line("none", "20.11.2026"),
      line("•", "Brot kaufen"),
      line("•", "Milch kaufen"),
      line("none", "stray"),
      line("•", ""),
    ] as OcrLine[],
    width: 10,
    height: 10,
    ms: 1,
  };
  const draft = buildLogDraft({ ocr, fallbackDate: "2026-11-19", now: 1000, ttlMs: 500 });
  assert.equal(draft.expires, 1500);
  assert.equal(draft.applied, false);
  const review = startReview(draft, [entry("e1", "task", "Milch kaufen")]);
  assert.equal(review.date, "2026-11-20");
  assert.equal(review.pageDate, "2026-11-20");
  assert.equal(review.fallbackDate, "2026-11-19");
  assert.deepEqual(review.items.map((i) => [i.title, i.status, i.include]), [
    ["Brot kaufen", "new", true],
    ["Milch kaufen", "duplicate", false],
    ["stray", "new", false],
    ["", "new", false],
  ]);
});

test("checkLines: answers the id, status and target of each line", () => {
  const checks = checkLines([{ id: "a", type: "done", title: "Brot kaufen" }], [entry("e1", "task", "Brot kaufen")]);
  assert.deepEqual(checks, [{ id: "a", status: "completes", target: { id: "e1", title: "Brot kaufen" } }]);
});
