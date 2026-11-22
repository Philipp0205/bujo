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
  return { id, date: TODAY, horizon: "day", type, title, tags: [], body: null, hasPhoto: false, time: null, indent: 0, sync: "local", syncError: null, position: 0, createdAt: 0, updatedAt: 0, onPaper: false };
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

test("parsePage: written #tags and a time leave the title and ride along with the line", () => {
  const page = parsePage([line("•", "Zahnarzt #health #Arzt #HEALTH 14h30", 0.9), line("•", "#home", 0.9)], TODAY);
  assert.equal(page.lines[0].title, "Zahnarzt");
  assert.deepEqual(page.lines[0].tags, ["health", "Arzt"]);
  assert.equal(page.lines[0].time, "14:30");
  assert.equal(page.lines[1].title, "#home");
  assert.deepEqual(page.lines[1].tags, []);
});

test("parsePage: an @ date word stays in the title, because scanned paper has no date field to put it in", () => {
  const page = parsePage([line("•", "Zahnarzt @morgen #health", 0.9)], TODAY);
  assert.equal(page.lines[0].title, "Zahnarzt @morgen");
  assert.deepEqual(page.lines[0].tags, ["health"]);
});

test("parsePage: no header line means no page date", () => {
  const page = parsePage([line("•", "Milch kaufen")], TODAY);
  assert.equal(page.pageDate, null);
  assert.equal(page.lines.length, 1);
});

test("resolveLines: an x line over an open task is an edit, a repeat is unchanged, the rest is new", () => {
  const existing = [entry("e1", "task", "Water the office plants"), entry("e2", "note", "Idee Wochenende"), entry("e3", "done", "Schon erledigt")];
  const lines = [
    { id: "a", type: "done" as const, title: "water the office plants" },
    { id: "c", type: "note" as const, title: "idee wochenende" },
    { id: "d", type: "task" as const, title: "Brot kaufen" },
    { id: "e", type: "done" as const, title: "Schon erledigt" },
  ];
  const out = resolveLines(lines, existing);
  assert.equal(out.get("a")?.status, "edited");
  assert.equal(out.get("a")?.target?.id, "e1");
  assert.deepEqual([out.get("a")?.before?.type, out.get("a")?.after?.type], ["task", "done"]);
  assert.equal(out.get("c")?.status, "unchanged");
  assert.equal(out.get("d")?.status, "new");
  assert.equal(out.get("e")?.status, "unchanged");
});

test("resolveLines: the same title twice binds one entry once, and an empty title matches nothing", () => {
  const existing = [entry("e1", "task", "Brot kaufen")];
  const out = resolveLines(
    [{ id: "a", type: "task", title: "Brot kaufen" }, { id: "b", type: "task", title: "Brot kaufen" }, { id: "c", type: "task", title: "" }],
    existing,
  );
  assert.equal(out.get("a")?.status, "unchanged");
  assert.equal(out.get("b")?.status, "new");
  assert.equal(out.get("c")?.status, "new");
});

test("startReview: a new draft starts on the page date, bulletless and empty lines start off, unchanged lines start off", () => {
  const ocr = {
    lines: [
      line("none", "20.11.2026"),
      line("•", "Brot kaufen"),
      line("•", "Milch kaufen"),
      line("x", "Eier holen"),
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
  const review = startReview(draft, [entry("e1", "task", "Milch kaufen"), entry("e2", "task", "Eier holen")]);
  assert.equal(review.date, "2026-11-20");
  assert.equal(review.pageDate, "2026-11-20");
  assert.equal(review.fallbackDate, "2026-11-19");
  assert.deepEqual(review.items.map((i) => [i.title, i.status, i.include]), [
    ["Brot kaufen", "new", true],
    ["Milch kaufen", "unchanged", false],
    ["Eier holen", "edited", true],
    ["stray", "new", false],
    ["", "new", false],
  ]);
});

test("checkLines: answers the id, status, target and before and after of each line", () => {
  const checks = checkLines(
    [{ id: "a", type: "done", title: "Brot kaufen" }, { id: "b", type: "task", title: "Neu" }],
    [entry("e1", "task", "Brot kaufen")],
  );
  assert.deepEqual(checks, [
    {
      id: "a",
      status: "edited",
      target: { id: "e1", title: "Brot kaufen" },
      before: { type: "task", title: "Brot kaufen", tags: [], time: null },
      after: { type: "done", title: "Brot kaufen", tags: [], time: null },
      contested: false,
    },
    { id: "b", status: "new", target: null, before: null, after: null, contested: false },
  ]);
});
