import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { parseMarkup, type MarkupOptions } from "../src/log/markup.ts";

type Result = { title: string; tag: string | null; time: string | null };

/** The browser twin, loaded the way a page loads it: a script that hangs itself on window.BujoLog. */
function loadBrowserParser(): (text: string, options?: MarkupOptions) => Result {
  const window: { BujoLog?: { markup: { parse: (text: string, options?: MarkupOptions) => Result } } } = {};
  const source = readFileSync(new URL("../public/js/log/markup.js", import.meta.url), "utf8");
  vm.runInNewContext(source, { window });
  return window.BujoLog!.markup.parse;
}

const FINAL = { final: true };
const LIVE = { final: false };

test("final: a written tag and time leave the title", () => {
  assert.deepEqual(parseMarkup("Zahnarzt #health 14:30", FINAL), { title: "Zahnarzt", tag: "health", time: "14:30" });
  assert.deepEqual(parseMarkup("#work Mira anrufen", FINAL), { title: "Mira anrufen", tag: "work", time: null });
  assert.deepEqual(parseMarkup("Call 9:05 Mira", FINAL), { title: "Call Mira", tag: null, time: "09:05" });
});

test("final: time spellings are normalised to HH:MM", () => {
  const time = (text: string) => parseMarkup(text, FINAL).time;
  assert.equal(time("a 14h"), "14:00");
  assert.equal(time("a 9h30"), "09:30");
  assert.equal(time("a 14h30"), "14:30");
  assert.equal(time("a 9:00"), "09:00");
  assert.equal(time("a 23:59"), "23:59");
});

test("final: the last tag and the last time win", () => {
  assert.deepEqual(parseMarkup("x #a #b 8:00 9:00", FINAL), { title: "x", tag: "b", time: "09:00" });
});

test("final: glued or odd words stay text", () => {
  for (const text of ["Plan #tag, soon", "foo#bar", "Call 14", "Frist 20.11.", "about 5h", "Zeit 24:00", "Zeit 9:60", "Platz #1", "# alone", "Sprint 3.5h"]) {
    assert.deepEqual(parseMarkup(text, FINAL), { title: text, tag: null, time: null }, text);
  }
});

test("final: a line that would be left with no title is kept as it is", () => {
  assert.deepEqual(parseMarkup("#home", FINAL), { title: "#home", tag: null, time: null });
  assert.deepEqual(parseMarkup("  #home 9:00  ", FINAL), { title: "#home 9:00", tag: null, time: null });
});

test("final: the title is trimmed and double spaces from cut words are not left behind", () => {
  assert.equal(parseMarkup("  a   #t   b  ", FINAL).title, "a   b");
  assert.equal(parseMarkup("a #t", FINAL).title, "a");
});

test("a tag longer than the tag limit is plain text", () => {
  const long = `#${"t".repeat(41)}`;
  assert.deepEqual(parseMarkup(`x ${long}`, FINAL), { title: `x ${long}`, tag: null, time: null });
  assert.equal(parseMarkup(`x #${"t".repeat(40)}`, FINAL).tag, "t".repeat(40));
});

test("live: the word at the end of the text may still be growing, so it is left alone", () => {
  assert.deepEqual(parseMarkup("Zahnarzt #hea", LIVE), { title: "Zahnarzt #hea", tag: null, time: null });
  assert.deepEqual(parseMarkup("Zahnarzt 9:0", LIVE), { title: "Zahnarzt 9:0", tag: null, time: null });
  assert.deepEqual(parseMarkup("Zahnarzt #health ", LIVE), { title: "Zahnarzt ", tag: "health", time: null });
  assert.deepEqual(parseMarkup("Zahnarzt 14:30 ", LIVE), { title: "Zahnarzt ", tag: null, time: "14:30" });
  assert.deepEqual(parseMarkup("#home ", LIVE), { title: "", tag: "home", time: null });
});

test("the default is a live parse", () => {
  assert.deepEqual(parseMarkup("x #a"), parseMarkup("x #a", LIVE));
});

const CORPUS = [
  "", " ", "plain title", "#home", "#home ", "  #home 9:00  ", "a #t", "a #t ", "  a   #t   b  ", "x #a #b 8:00 9:00",
  "Zahnarzt #health 14:30", "#work Mira anrufen", "Call 9:05 Mira", "a 14h", "a 14h ", "a 9h30", "a 5h", "a 5h ", "a 24:00 ",
  "Plan #tag, soon", "foo#bar ", "Platz #1 ", "# alone", "Müller #Übung 7h15 !", "Zeit 9:60 ", "tab\t#t\tend", "line\n#t\nend",
  `x #${"t".repeat(40)} `, `x #${"t".repeat(41)} `, "emoji #tag\u{1F600} ", "#a-b_c 10:15", "#-x- 1:5",
];

test("the browser twin and the TypeScript parser agree on every line, live and final", () => {
  const browser = loadBrowserParser();
  for (const text of CORPUS) {
    for (const options of [LIVE, FINAL, undefined]) {
      const twin = JSON.parse(JSON.stringify(browser(text, options)));
      assert.deepEqual(twin, parseMarkup(text, options), `${JSON.stringify(text)} ${JSON.stringify(options)}`);
    }
  }
});
