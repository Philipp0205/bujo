import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Item = Record<string, unknown>;
type Shape = { viewBox: string; strokes: { d: string; width: number }[] };
type Api = {
  note(item: Item): string;
  hasMatch(item: Item): boolean;
  scribble: { seedOf(text: string): number; pill(seed: string): Shape; ring(seed: string): Shape };
  model: { setClock(now: () => Date): void };
};

/** The real copy, scan model, note and scribble files in a page-like sandbox. */
function load(): Api {
  const L: { copy: object; dates?: object; scan?: { note: Api; scribble: Api["scribble"]; model: Api["model"] } } = { copy: {} };
  const window = { BujoLog: L };
  const context = vm.createContext({ window, String, Math, Number, Array, Object, RegExp, Date, Blob: class {} });
  for (const file of ["scan/copy.js", "scan/model.js", "scan/note.js", "scan/scribble.js"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), context);
  }
  const scan = L.scan!;
  return { note: scan.note.note, hasMatch: scan.note.hasMatch, scribble: scan.scribble, model: scan.model };
}

const { note, hasMatch, scribble } = load();
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const edited = (extra: Item = {}): Item => ({
  confidence: 0.92, status: "edited", include: true, title: "Semmeln kaufen", tags: [],
  type: "done", target: { title: "Semmeln kaufen", type: "task" },
  before: { type: "task", title: "Semmeln kaufen", time: null }, after: { type: "done" }, ...extra,
});

test("the same seed draws the same scribble, another seed another one", () => {
  assert.deepEqual(plain(scribble.pill("l1")), plain(scribble.pill("l1")));
  assert.deepEqual(plain(scribble.ring("l1")), plain(scribble.ring("l1")));
  assert.notEqual(scribble.pill("l1").strokes[0].d, scribble.pill("l2").strokes[0].d);
  assert.equal(scribble.seedOf("abc"), scribble.seedOf("abc"));
});

test("a scribble has two imperfect passes inside its box and no fill", () => {
  const shape = scribble.pill("l1");
  assert.equal(shape.viewBox, "0 0 200 40");
  assert.equal(shape.strokes.length, 2);
  assert.ok(shape.strokes[0].width > shape.strokes[1].width);
  for (const stroke of shape.strokes) {
    assert.match(stroke.d, /^M[-\d. ]+( Q[-\d. ]+)+ L[-\d. ]+$/);
    const numbers = (stroke.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    assert.ok(numbers.every((n) => n > -12 && n < 212));
  }
  assert.notEqual(shape.strokes[0].d, shape.strokes[1].d);
});

test("a ring is centered on the middle of its box", () => {
  for (const seed of ["a", "b", "c", "x1", "x2"]) {
    const points = scribble.ring(seed).strokes.flatMap((stroke) => (stroke.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number));
    const xs = points.filter((_, at) => at % 2 === 0);
    const ys = points.filter((_, at) => at % 2 === 1);
    assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 12) < 1.2);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 12) < 1.2);
  }
});

test("a matched line says what it matches and the change, never a percent, without repeating the title", () => {
  assert.equal(note(edited()), "matches, will be marked as done");
  assert.equal(note(edited({ before: { type: "task", title: "Semmeln kaufen" }, after: { type: "task" }, status: "unchanged" })), "already matches");
  assert.ok(!/%/.test(note(edited())));
});

test("an entry whose text differs shows the old text once, with the change after the arrow", () => {
  assert.equal(note(edited({ title: "Semmeln", before: { type: "task", title: "Semmeln kaufen" } })), "was \u2022 Semmeln kaufen \u2192 done");
  assert.equal(note(edited({ type: "task", title: "Brot kaufen", before: { type: "task", title: "Semmeln kaufen" }, after: { type: "task" } })), "was \u2022 Semmeln kaufen \u2192 updated");
});

test("a confident new line has an empty note, a low confidence one says it is hard to read", () => {
  const fresh = { confidence: 0.94, status: "new", title: "Brief", tags: [] };
  assert.equal(note(fresh), "");
  assert.equal(note({ ...fresh, time: "09:00" }), "09:00");
  assert.equal(note({ ...fresh, confidence: 0.71 }), "hard to read, check the text");
  assert.equal(note(edited({ confidence: 0.71 })), "matches, will be marked as done, hard to read, check the text");
  assert.equal(note(edited({ confidence: 0.71, title: "Semmeln", before: { type: "task", title: "Semmeln kaufen" } })), "was \u2022 Semmeln kaufen \u2192 done, hard to read, check the text");
  assert.equal(hasMatch(fresh), false);
});

test("time, the old time, importance and an app change join the same line", () => {
  const line = note(edited({ time: "09:00", important: true, contested: true, before: { type: "task", title: "Semmeln kaufen", time: "08:00" } }));
  assert.equal(line, "matches, will be marked as done, 09:00, time was 08:00, important, also changed in the app");
  assert.ok(!line.includes("\n"));
  assert.equal(note(edited({ time: "09:00", before: { type: "task", title: "Semmeln kaufen", time: null } })).includes("time was none"), true);
});

test("an un-matched line says it is new, and can match again", () => {
  const unmatched = { confidence: 0.9, status: "new", title: "Brief", tags: [], unmatched: true, wasMatch: { kind: "entry", title: "Brief alt" } };
  assert.equal(note(unmatched), "new entry, not Brief alt");
  assert.equal(hasMatch(unmatched), true);
});
