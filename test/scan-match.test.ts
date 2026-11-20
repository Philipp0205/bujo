import assert from "node:assert/strict";
import test from "node:test";
import { correctWords, levenshtein, matchKey, matchLine, MATCH_THRESHOLD, normalise, similarity } from "../src/scan/match.ts";
import { CORRECTIONS } from "../src/scan/wordlist.ts";

const task = (uid: string, summary: string, list = "Aufgaben") => ({ list, uid, summary });

const BACKLOG = [
  task("a", "Gutachten lesen, kommentieren; abgeben"),
  task("b", "Zahnarzt anrufen"),
  task("c", "Steuererklärung abgeben"),
  task("d", "Dachboden aufräumen"),
  task("e", "Bericht schreiben", "Arbeit"),
  task("f", "Task 1"),
  task("g", "Task 2"),
];

test("normalise: lowercase, punctuation out, spaces collapsed, umlauts spelled out", () => {
  assert.equal(normalise("  Steuer-Erklärung,  ABGEBEN!! "), "steuer erklaerung abgeben");
  assert.equal(normalise("Müller & Söhne: Straße"), "mueller soehne strasse");
  assert.equal(normalise("Café"), "cafe");
  assert.equal(normalise("…"), "");
});

test("normalise: a decomposed umlaut equals the composed one", () => {
  assert.equal(normalise("Mu\u0308ller"), normalise("Müller"));
});

test("wordlist: Tush, Tash and Tosh are Task, with case and punctuation kept around them", () => {
  assert.equal(correctWords("Tush 1"), "Task 1");
  assert.equal(correctWords("tash: eins"), "task: eins");
  assert.equal(correctWords("TOSH"), "Task");
  assert.equal(correctWords("Tushy"), "Tushy");
  for (const [wrong, right] of Object.entries(CORRECTIONS)) assert.equal(matchKey(wrong), right);
});

test("levenshtein basics", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("abc", "abc"), 0);
});

test("fuzzy: an exact title matches with score 1, case and punctuation do not matter", () => {
  const result = matchLine("zahnarzt  ANRUFEN!", BACKLOG);
  assert.equal(result.match?.uid, "b");
  assert.equal(result.match?.score, 1);
  assert.equal(result.ambiguous, false);
});

test("fuzzy: OCR noise still matches (a few wrong letters)", () => {
  assert.equal(matchLine("Zahnarzt anrufcn", BACKLOG).match?.uid, "b");
  assert.equal(matchLine("Steuererklarung abgeben", BACKLOG).match?.uid, "c");
  assert.equal(matchLine("Dachbod en aufraumen", BACKLOG).match?.uid, "d");
});

test("fuzzy: umlauts and their ae oe ue spelling match each other", () => {
  assert.equal(matchLine("Steuererklaerung abgeben", BACKLOG).match?.uid, "c");
  assert.equal(matchLine("Dachboden aufräumen", BACKLOG).match?.uid, "d");
});

test("fuzzy: a few words of a long title match it", () => {
  const result = matchLine("Gutachten lesen", BACKLOG);
  assert.equal(result.match?.uid, "a");
});

test("fuzzy: tasks from both lists are candidates and the list comes back", () => {
  const result = matchLine("Bericht schreiben", BACKLOG);
  assert.deepEqual([result.match?.list, result.match?.uid, result.match?.summary], ["Arbeit", "e", "Bericht schreiben"]);
});

test("the word list turns Tush 1 into a match for Task 1, and the number keeps it from Task 2", () => {
  const result = matchLine("Tush 1", BACKLOG);
  assert.equal(result.match?.uid, "f");
  assert.ok(result.match!.score >= MATCH_THRESHOLD);
  assert.equal(result.ambiguous, false);
  assert.equal(matchLine("Tosh 2", BACKLOG).match?.uid, "g");
});

test("weak match: something unrelated is no match and offers no candidates", () => {
  const result = matchLine("Geburtstagsgeschenk kaufen", BACKLOG);
  assert.equal(result.match, null);
  assert.equal(result.ambiguous, false);
  assert.deepEqual(result.candidates, []);
});

test("weak match: a loose resemblance is a candidate for the review but not a match", () => {
  const result = matchLine("Zahnarzt", [task("z", "Zahnarzt Termin vereinbaren fuer naechste Woche")]);
  assert.equal(result.match, null);
});

test("ambiguous: two near-identical open tasks give no match and say so", () => {
  const twins = [task("t1", "Rechnung bezahlen"), task("t2", "Rechnungen bezahlen"), task("t3", "Milch kaufen")];
  // An exact title is clear even with a close sibling.
  const exact = matchLine("Rechnung bezahlen", twins);
  assert.equal(exact.match?.uid, "t1");
  assert.equal(exact.ambiguous, false);
  // A noisy line that fits both about equally is not decided here.
  const noisy = matchLine("Rechnunq bezahlen", twins);
  assert.equal(noisy.ambiguous, true);
  assert.equal(noisy.match, null);
  assert.deepEqual(noisy.candidates.slice(0, 2).map((c) => c.uid), ["t1", "t2"]);
});

test("ambiguous: the same title in two lists is ambiguous", () => {
  const both = [task("p", "Steuer abgeben", "Aufgaben"), task("q", "Steuer abgeben", "Arbeit")];
  const result = matchLine("Steuer abgeben", both);
  assert.equal(result.ambiguous, true);
  assert.equal(result.match, null);
});

test("empty text matches nothing", () => {
  assert.deepEqual(matchLine("  ...  ", BACKLOG), { match: null, ambiguous: false, candidates: [] });
});

test("similarity is symmetric enough and bounded", () => {
  for (const [a, b] of [["task 1", "task 2"], ["zahnarzt", "zahnarzt anrufen"], ["a", "b"]]) {
    const s = similarity(a, b);
    assert.ok(s >= 0 && s <= 1, `${a} ${b} ${s}`);
  }
  assert.ok(similarity("task 1", "task 2") < MATCH_THRESHOLD);
});
