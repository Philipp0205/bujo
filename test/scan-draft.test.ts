import assert from "node:assert/strict";
import test from "node:test";
import { buildDraft, actionFor, parseDateLine, type BuildInput, type DraftItem } from "../src/scan/draft.ts";
import { createDraftStore, DRAFT_MAX, DRAFT_TTL_MS } from "../src/scan/store.ts";
import { line } from "./fake-ocr.ts";

const OPEN = [
  { list: "Aufgaben", uid: "fx-termin", summary: "Zahnarzt anrufen" },
  { list: "Aufgaben", uid: "fx-process", summary: "Umzug planen" },
  { list: "Arbeit", uid: "fx-bericht", summary: "Bericht schreiben" },
  { list: "Aufgaben", uid: "task-1", summary: "Task 1" },
];

function draftOf(lines: ReturnType<typeof line>[], extra: Partial<BuildInput> = {}) {
  return buildDraft({
    ocr: { lines, width: 900, height: 700, ms: 5 },
    open: OPEN,
    lists: ["Aufgaben", "Arbeit"],
    defaultList: "Aufgaben",
    scanDay: "2026-11-20",
    now: 1_000_000,
    ttlMs: DRAFT_TTL_MS,
    ...extra,
  });
}

const itemOf = (lines: ReturnType<typeof line>[]): DraftItem => draftOf(lines).items[0];

test("x with a matching open task proposes complete, included", () => {
  const item = itemOf([line("x", "Zahnarzt anrufen")]);
  assert.equal(item.action, "complete");
  assert.equal(item.include, true);
  assert.equal(item.match?.uid, "fx-termin");
});

test("x without a match is excluded by default, with a note", () => {
  const item = itemOf([line("x", "Etwas ganz anderes")]);
  assert.equal(item.action, "complete");
  assert.equal(item.match, null);
  assert.equal(item.include, false);
  assert.match(item.note ?? "", /No matching open task/);
});

test("bullet without a match creates, with a match keeps", () => {
  const created = itemOf([line("•", "Milch kaufen")]);
  assert.deepEqual([created.action, created.include, created.match], ["create", true, null]);
  const kept = itemOf([line("•", "Umzug planen")]);
  assert.deepEqual([kept.action, kept.include, kept.match?.uid], ["keep", true, "fx-process"]);
});

test("> is the same as the bullet: keep the match, else create", () => {
  assert.equal(itemOf([line(">", "Umzug planen")]).action, "keep");
  assert.equal(itemOf([line(">", "Neue Sache")]).action, "create");
});

test("< schedules, has no due yet, and is included", () => {
  const item = itemOf([line("<", "Zahnarzt anrufen")]);
  assert.equal(item.action, "schedule");
  assert.equal(item.due, null);
  assert.equal(item.match?.uid, "fx-termin");
  assert.equal(itemOf([line("<", "Neue Sache")]).match, null);
});

test("event and note are ignored and excluded", () => {
  for (const symbol of ["○", "–"] as const) {
    const item = itemOf([line(symbol, "Geburtstag Oma")]);
    assert.deepEqual([item.action, item.include], ["ignore", false]);
    assert.equal(item.match, null);
  }
});

test("a none line is excluded, and the first date line is the page date", () => {
  const draft = draftOf([line("none", "Montag"), line("none", "20.11.2025"), line("none", "21.11.2025"), line("•", "Milch kaufen")]);
  assert.equal(draft.pageDate, "2025-11-20");
  assert.equal(draft.pageDateSource, "line");
  assert.deepEqual(draft.items.map((i) => [i.include, i.isDate]), [[false, false], [false, true], [false, false], [true, false]]);
});

test("without a date line the page date is the scan day", () => {
  const draft = draftOf([line("•", "Milch kaufen")]);
  assert.deepEqual([draft.pageDate, draft.pageDateSource, draft.scanDay], ["2026-11-20", "scan", "2026-11-20"]);
});

test("the default list is Aufgaben and every item carries it", () => {
  const draft = draftOf([line("•", "A"), line("•", "B")]);
  assert.equal(draft.defaultList, "Aufgaben");
  assert.deepEqual(draft.items.map((i) => i.list), ["Aufgaben", "Aufgaben"]);
  assert.deepEqual(draft.lists, ["Aufgaben", "Arbeit"]);
});

test("OCR noise: Tush 1 is corrected to Task 1 and keeps the existing task", () => {
  const item = itemOf([line("•", "Tush 1")]);
  assert.equal(item.text, "Task 1");
  assert.equal(item.ocrText, "Tush 1");
  assert.equal(item.action, "keep");
  assert.equal(item.match?.uid, "task-1");
});

test("an empty line is excluded", () => {
  const item = itemOf([line("•", "  ")]);
  assert.equal(item.include, false);
});

test("ids are l1, l2, ... in page order, and the draft never holds an image", () => {
  const draft = draftOf([line("•", "A"), line("x", "B")]);
  assert.deepEqual(draft.items.map((i) => i.id), ["l1", "l2"]);
  assert.deepEqual(Object.keys(draft.image).sort(), ["height", "width"]);
  assert.equal(draft.expires - draft.created, DRAFT_TTL_MS);
});

test("actionFor", () => {
  assert.equal(actionFor("x", false), "complete");
  assert.equal(actionFor("<", true), "schedule");
  assert.equal(actionFor("none", true), "ignore");
});

test("parseDateLine: dd.mm.yyyy, dd.mm.yy, and OCR noise", () => {
  assert.equal(parseDateLine("20.11.2025"), "2025-11-20");
  assert.equal(parseDateLine("5.1.26"), "2026-01-05");
  assert.equal(parseDateLine("Do 20.11.2025"), "2025-11-20");
  assert.equal(parseDateLine("2O.11.2O25"), "2025-11-20");
  assert.equal(parseDateLine("20,11,2025"), "2025-11-20");
  assert.equal(parseDateLine("20-11-2025"), "2025-11-20");
  assert.equal(parseDateLine("2l.1l.2025"), "2025-11-21");
  assert.equal(parseDateLine("20 11 2025"), "2025-11-20");
  assert.equal(parseDateLine("31.02.2025"), null);
  assert.equal(parseDateLine("Montag"), null);
  assert.equal(parseDateLine("Task 12"), null);
  assert.equal(parseDateLine("1.2"), null);
});

test("draft store: expires after 24 hours and keeps at most a few", () => {
  let now = 0;
  const store = createDraftStore({ now: () => now });
  const make = (id: string) => ({ ...draftOf([line("•", "A")], { id, now, ttlMs: DRAFT_TTL_MS }) });
  store.add(make("one"));
  now = DRAFT_TTL_MS - 1;
  assert.ok(store.get("one"));
  now = DRAFT_TTL_MS;
  assert.equal(store.get("one"), undefined);
  assert.equal(store.size(), 0);

  for (let i = 0; i < DRAFT_MAX + 3; i++) store.add(make(`d${i}`));
  assert.equal(store.size(), DRAFT_MAX);
  assert.equal(store.get("d0"), undefined);
  assert.ok(store.get(`d${DRAFT_MAX + 2}`));
});
