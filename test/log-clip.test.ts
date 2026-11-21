import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Entry = { type: string; title: string; date: string; position: number; createdAt?: number; tags?: string[]; time?: string | null; indent?: number };

/** The browser modules, loaded the way a page loads them: scripts that hang themselves on one window.BujoLog. */
function load(): { format: (entries: Entry[]) => string } {
  const window: { BujoLog?: { clip: { format: (entries: Entry[]) => string } } } = {};
  for (const file of ["copy.js", "days.js", "clip.js"]) {
    vm.runInNewContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), { window });
  }
  return window.BujoLog!.clip;
}

const clip = load();
let next = 0;
/** An entry on a day. Position follows the order the helper is called in, unless given. */
const entry = (type: string, title: string, date: string, extra: Partial<Entry> = {}): Entry => ({
  type, title, date, position: next++, createdAt: 0, tags: [], time: null, indent: 0, ...extra,
});

test("clip: every type has its paper symbol", () => {
  const types: Array<[string, string]> = [["task", "\u2022"], ["done", "x"], ["migrated", ">"], ["scheduled", "<"], ["event", "\u25cb"], ["note", "\u2013"]];
  for (const [type, symbol] of types) {
    assert.equal(clip.format([entry(type, "Eins", "2026-11-23")]), `${symbol} Eins`);
  }
});

test("clip: tags come in stored order with a hash, then the time", () => {
  const text = clip.format([entry("task", "Milch kaufen", "2026-11-23", { tags: ["haushalt", "Küche"], time: "09:00" })]);
  assert.equal(text, "\u2022 Milch kaufen #haushalt #Küche 09:00");
});

test("clip: a line with no time and no tags is just symbol and title", () => {
  assert.equal(clip.format([entry("note", "Freie Notiz", "2026-11-23")]), "\u2013 Freie Notiz");
});

test("clip: umlauts in titles and tags are copied as they are", () => {
  const text = clip.format([
    entry("task", "Küche putzen", "2026-11-23", { tags: ["Küche"] }),
    entry("note", "Größe der Straße", "2026-11-23", { tags: ["Straße", "Größe"] }),
  ]);
  assert.equal(text, "\u2022 Küche putzen #Küche\n\u2013 Größe der Straße #Straße #Größe");
});

test("clip: entries of one day have no header and no date token", () => {
  const text = clip.format([
    entry("task", "Milch kaufen", "2026-11-23", { tags: ["haushalt", "Küche"], time: "09:00" }),
    entry("done", "Pflanzen giessen", "2026-11-23", { tags: ["garten"] }),
    entry("note", "Freie Notiz", "2026-11-23"),
  ]);
  assert.equal(text, "\u2022 Milch kaufen #haushalt #Küche 09:00\nx Pflanzen giessen #garten\n\u2013 Freie Notiz");
  assert.ok(!text.includes("@"));
});

test("clip: several days get German headers, date order, a blank line between groups and no trailing blank line", () => {
  const text = clip.format([
    entry("event", "Lunch mit Mira", "2026-11-24", { tags: ["work"], time: "12:30" }),
    entry("task", "Milch kaufen", "2026-11-23", { tags: ["haushalt"], time: "09:00" }),
    entry("done", "Pflanzen giessen", "2026-11-23"),
  ]);
  assert.equal(
    text,
    "Montag 23.11.\n\u2022 Milch kaufen #haushalt 09:00\nx Pflanzen giessen\n\nDienstag 24.11.\n\u25cb Lunch mit Mira #work 12:30",
  );
  assert.ok(!text.endsWith("\n"));
});

test("clip: every German weekday name", () => {
  const days = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"];
  const text = clip.format(days.map((date) => entry("task", "x", date)));
  const headers = text.split("\n\n").map((group) => group.split("\n")[0]);
  assert.deepEqual(headers, [
    "Sonntag 22.11.", "Montag 23.11.", "Dienstag 24.11.", "Mittwoch 25.11.", "Donnerstag 26.11.", "Freitag 27.11.", "Samstag 28.11.",
  ]);
});

test("clip: lines follow the position within a day, not the order they were given", () => {
  const text = clip.format([
    entry("task", "dritte", "2026-11-23", { position: 3 }),
    entry("task", "erste", "2026-11-23", { position: 1 }),
    entry("task", "zweite", "2026-11-23", { position: 2 }),
  ]);
  assert.equal(text, "\u2022 erste\n\u2022 zweite\n\u2022 dritte");
});

test("clip: a selected child without its parent is included, flush left", () => {
  const text = clip.format([entry("task", "Kind", "2026-11-23", { indent: 1, position: 2 })]);
  assert.equal(text, "\u2022 Kind");
});

test("clip: a selected parent does not bring its children", () => {
  const parent = entry("task", "Eltern", "2026-11-23", { position: 1 });
  entry("task", "Kind", "2026-11-23", { indent: 1, position: 2 });
  assert.equal(clip.format([parent]), "\u2022 Eltern");
});

test("clip: a parent and a child together are two flush-left lines", () => {
  const text = clip.format([
    entry("task", "Kind", "2026-11-23", { indent: 1, position: 2 }),
    entry("task", "Eltern", "2026-11-23", { position: 1 }),
  ]);
  assert.equal(text, "\u2022 Eltern\n\u2022 Kind");
});
