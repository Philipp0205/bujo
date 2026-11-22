import assert from "node:assert/strict";
import test from "node:test";
import {
  checkEntryPatch,
  checkNewEntry,
  checkRange,
  isEntryId,
  isValidDate,
  isValidTime,
  RANGE_MAX_DAYS,
  TAG_MAX,
  TAGS_MAX,
  TITLE_MAX,
} from "../src/log/validation.ts";

test("isValidDate accepts real days only", () => {
  assert.ok(isValidDate("2026-11-20"));
  assert.ok(isValidDate("2028-02-29"));
  for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-1", "20.11.2026", "", 20261120, null]) {
    assert.equal(isValidDate(bad), false, String(bad));
  }
});

test("isValidTime accepts HH:MM on a 24 hour clock", () => {
  assert.ok(isValidTime("00:00") && isValidTime("13:30") && isValidTime("23:59"));
  for (const bad of ["24:00", "12:60", "1:30", "13:30:00", "noon", "", null]) assert.equal(isValidTime(bad), false, String(bad));
});

test("checkRange: a good range, a reversed one, a bad date and the span cap", () => {
  assert.deepEqual(checkRange("2026-11-14", "2026-11-27"), { ok: true, value: { from: "2026-11-14", to: "2026-11-27" } });
  assert.deepEqual(checkRange("2026-11-20", "2026-11-20"), { ok: true, value: { from: "2026-11-20", to: "2026-11-20" } });
  assert.equal(checkRange("2026-11-21", "2026-11-20").ok, false);
  assert.equal(checkRange(null, "2026-11-20").ok, false);
  assert.equal(checkRange("2026-11-20", "soon").ok, false);
  assert.equal(checkRange("2026-02-30", "2026-03-02").ok, false);
  // 92 days inclusive is fine, 93 is not.
  assert.equal(checkRange("2026-01-01", "2026-04-02").ok, true);
  assert.equal(checkRange("2026-01-01", "2026-04-03").ok, false);
  assert.equal(RANGE_MAX_DAYS, 92);
});

test("checkNewEntry trims, defaults tags and time to none and keeps the rest", () => {
  const checked = checkNewEntry({ date: "2026-11-20", type: "event", title: "  Lunch mit Mira  ", tags: [" Freizeit ", "Mira"], time: "13:00" });
  assert.deepEqual(checked, { ok: true, value: { date: "2026-11-20", type: "event", title: "Lunch mit Mira", tags: ["Freizeit", "Mira"], time: "13:00", body: null } });
  assert.deepEqual(checkNewEntry({ date: "2026-11-20", type: "task", title: "Küchengarten ä ö ü ß" }), {
    ok: true,
    value: { date: "2026-11-20", type: "task", title: "Küchengarten ä ö ü ß", tags: [], time: null, body: null },
  });
  // An empty tag list and a blank time mean none.
  assert.deepEqual(checkNewEntry({ date: "2026-11-20", type: "note", title: "x", tags: [], time: "" }), {
    ok: true,
    value: { date: "2026-11-20", type: "note", title: "x", tags: [], time: null, body: null },
  });
});

test("checkNewEntry drops a repeated tag ignoring case and keeps the first spelling and the order", () => {
  const checked = checkNewEntry({ date: "2026-11-20", type: "task", title: "x", tags: ["Reise", "work", "reise", " WORK ", "Küche"] });
  assert.deepEqual(checked.ok && checked.value.tags, ["Reise", "work", "Küche"]);
});

test("checkNewEntry refuses missing, empty, long, malformed and unknown input", () => {
  const base = { date: "2026-11-20", type: "task", title: "x" };
  const refused: Array<Record<string, unknown>> = [
    { type: "task", title: "x" },
    { date: "2026-11-20", title: "x" },
    { date: "2026-11-20", type: "task" },
    { ...base, title: "   " },
    { ...base, title: 5 },
    { ...base, title: "x".repeat(TITLE_MAX + 1) },
    { ...base, title: "two\nlines" },
    { ...base, tags: ["t".repeat(TAG_MAX + 1)] },
    { ...base, tags: [7] },
    { ...base, tags: ["a", ""] },
    { ...base, tags: ["a\nb"] },
    { ...base, tags: "Reise" },
    { ...base, tags: null },
    { ...base, tag: "Reise" },
    { ...base, date: "20.11.2026" },
    { ...base, type: "idea" },
    { ...base, time: "25:00" },
    { ...base, sync: "synced" },
    { ...base, extra: 1 },
  ];
  for (const body of refused) assert.equal(checkNewEntry(body).ok, false, JSON.stringify(body));
  assert.equal(checkNewEntry({ ...base, title: "x".repeat(TITLE_MAX) }).ok, true);
  assert.equal(checkNewEntry({ ...base, tags: ["t".repeat(TAG_MAX)] }).ok, true);
});

test("checkNewEntry allows an id only when it is a lowercase UUID, and keeps it", () => {
  const base = { date: "2026-11-20", type: "task", title: "x" };
  const id = "3f2b8c1e-9a4d-4e7f-8b6a-1c2d3e4f5a6b";
  const good = checkNewEntry({ ...base, id });
  assert.deepEqual(good, { ok: true, value: { id, date: "2026-11-20", type: "task", title: "x", tags: [], time: null, body: null } });
  assert.equal("id" in (checkNewEntry(base) as { value: object }).value, false);
  for (const bad of ["", "abc", id.toUpperCase(), id.replace(/-/g, ""), `${id}0`, " " + id, 7, null, {}]) {
    const checked = checkNewEntry({ ...base, id: bad });
    assert.equal(checked.ok, false, JSON.stringify(bad));
    assert.match(checked.ok ? "" : checked.error, /^id must be a UUID/);
  }
  assert.equal(isEntryId(id), true);
  assert.equal(checkNewEntry({ ...base, id, extra: 1 }).ok, false);
});

test("the old single tag field is refused with a message that names tags", () => {
  const checked = checkNewEntry({ date: "2026-11-20", type: "task", title: "x", tag: "Reise" });
  assert.deepEqual(checked, { ok: false, error: "tag is gone: send tags, a list of text" });
  assert.equal(checkEntryPatch({ tag: null }).ok, false);
});

test("a list may hold TAGS_MAX tags and no more", () => {
  const base = { date: "2026-11-20", type: "task", title: "x" };
  const tags = (count: number) => Array.from({ length: count }, (_, i) => `t${i}`);
  assert.equal(checkNewEntry({ ...base, tags: tags(TAGS_MAX) }).ok, true);
  const over = checkNewEntry({ ...base, tags: tags(TAGS_MAX + 1) });
  assert.deepEqual(over, { ok: false, error: `tags has too many entries (at most ${TAGS_MAX})` });
});

test("checkEntryPatch keeps only the keys given and lets an empty list or null clear tags and time", () => {
  assert.deepEqual(checkEntryPatch({ title: " New " }), { ok: true, value: { title: "New" } });
  assert.deepEqual(checkEntryPatch({ tags: [], time: null }), { ok: true, value: { tags: [], time: null } });
  assert.deepEqual(checkEntryPatch({ tags: ["a", "b"], time: "" }), { ok: true, value: { tags: ["a", "b"], time: null } });
  assert.deepEqual(checkEntryPatch({ type: "done", date: "2026-11-21" }), { ok: true, value: { type: "done", date: "2026-11-21" } });
});

test("checkEntryPatch refuses an empty patch, a bad value, sync and unknown keys", () => {
  for (const body of [{}, { title: "" }, { title: null }, { type: "x" }, { date: "tomorrow" }, { time: "9" }, { sync: "synced" }, { id: "a" }]) {
    assert.equal(checkEntryPatch(body).ok, false, JSON.stringify(body));
  }
});
