import assert from "node:assert/strict";
import test from "node:test";
import { detectKind } from "../src/log/scan/kind.ts";
import { parsePage } from "../src/log/scan/parse.ts";
import { findSections, parseSection, sectionOf } from "../src/log/scan/sections.ts";
import { line } from "./fake-ocr.ts";

const TODAY = "2026-11-20";

test("a section heading names work or private in English and German, in any case, with or without a colon", () => {
  for (const text of ["Work", "work:", "WORK", "Arbeit", "arbeit"]) assert.equal(parseSection(text), "work", text);
  for (const text of ["Private", "Privat", "Personal", "PRIVAT:", "personal"]) assert.equal(parseSection(text), "private", text);
  for (const text of ["Workshop", "Arbeit planen", "Brot kaufen", "", "November"]) assert.equal(parseSection(text), null, text);
});

test("only a line with no bullet is a section heading, and a line takes the nearest heading above it", () => {
  const lines = [line("none", "November"), line("none", "Work"), line("•", "Bericht"), line("•", "Meeting"), line("none", "Privat"), line("•", "Steuer"), line("•", "Work")];
  const sections = findSections(lines);
  assert.deepEqual([...sections], [[1, "work"], [4, "private"]]);
  assert.deepEqual([0, 2, 3, 5].map((index) => sectionOf(index, sections)), [null, "work", "work", "private"]);
});

test("a month-task page drops its section headings and gives each line its section", () => {
  const page = parsePage(
    [line("none", "November"), line("none", "Work"), line("•", "Bericht schreiben"), line("none", "Privat"), line("•", "Geschenke kaufen"), line("•", "Steuer")],
    TODAY,
    "month-task",
  );
  assert.deepEqual(page.lines.map((entry) => [entry.title, entry.section]), [["Bericht schreiben", "work"], ["Geschenke kaufen", "private"], ["Steuer", "private"]]);
  assert.deepEqual(page.lines.map((entry) => entry.id), ["l3", "l5", "l6"]);
});

test("lines above any section heading, and pages with none, have no section", () => {
  const page = parsePage([line("none", "November"), line("•", "Erst"), line("none", "Work"), line("•", "Dann")], TODAY, "month-task");
  assert.deepEqual(page.lines.map((entry) => entry.section), [null, "work"]);
  assert.deepEqual(parsePage([line("none", "November"), line("•", "Nur")], TODAY, "month-task").lines.map((entry) => entry.section), [null]);
});

test("a monthly page with a Work or Private heading reads as the tasks page even with day rows, else as before", () => {
  const days = [line("none", "1 Mo"), line("•", "a"), line("none", "2 Di"), line("•", "b"), line("none", "3 Mi"), line("•", "c")];
  assert.equal(detectKind([line("none", "November"), ...days], null, TODAY).kind, "calendar");
  assert.equal(detectKind([line("none", "November"), line("none", "Work"), ...days], null, TODAY).kind, "month-task");
  assert.equal(detectKind([line("none", "November"), line("none", "Privat"), line("•", "x")], null, TODAY).kind, "month-task");
});
