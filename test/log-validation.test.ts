import assert from "node:assert/strict";
import test from "node:test";
import {
  checkEntryPatch,
  checkNewEntry,
  checkRange,
  isValidDate,
  isValidTime,
  RANGE_MAX_DAYS,
  TAG_MAX,
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

test("checkNewEntry trims, defaults tag and time to null and keeps the rest", () => {
  const checked = checkNewEntry({ date: "2026-11-20", type: "event", title: "  Lunch mit Mira  ", tag: " Freizeit ", time: "13:00" });
  assert.deepEqual(checked, { ok: true, value: { date: "2026-11-20", type: "event", title: "Lunch mit Mira", tag: "Freizeit", time: "13:00", body: null } });
  assert.deepEqual(checkNewEntry({ date: "2026-11-20", type: "task", title: "Küchengarten ä ö ü ß" }), {
    ok: true,
    value: { date: "2026-11-20", type: "task", title: "Küchengarten ä ö ü ß", tag: null, time: null, body: null },
  });
  // A blank tag or time means none.
  assert.deepEqual(checkNewEntry({ date: "2026-11-20", type: "note", title: "x", tag: "   ", time: "" }), {
    ok: true,
    value: { date: "2026-11-20", type: "note", title: "x", tag: null, time: null, body: null },
  });
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
    { ...base, tag: "t".repeat(TAG_MAX + 1) },
    { ...base, tag: 7 },
    { ...base, date: "20.11.2026" },
    { ...base, type: "idea" },
    { ...base, time: "25:00" },
    { ...base, sync: "synced" },
    { ...base, extra: 1 },
  ];
  for (const body of refused) assert.equal(checkNewEntry(body).ok, false, JSON.stringify(body));
  assert.equal(checkNewEntry({ ...base, title: "x".repeat(TITLE_MAX) }).ok, true);
});

test("checkEntryPatch keeps only the keys given and lets null clear a tag or time", () => {
  assert.deepEqual(checkEntryPatch({ title: " New " }), { ok: true, value: { title: "New" } });
  assert.deepEqual(checkEntryPatch({ tag: null, time: null }), { ok: true, value: { tag: null, time: null } });
  assert.deepEqual(checkEntryPatch({ tag: "", time: "" }), { ok: true, value: { tag: null, time: null } });
  assert.deepEqual(checkEntryPatch({ type: "done", date: "2026-11-21" }), { ok: true, value: { type: "done", date: "2026-11-21" } });
});

test("checkEntryPatch refuses an empty patch, a bad value, sync and unknown keys", () => {
  for (const body of [{}, { title: "" }, { title: null }, { type: "x" }, { date: "tomorrow" }, { time: "9" }, { sync: "synced" }, { id: "a" }]) {
    assert.equal(checkEntryPatch(body).ok, false, JSON.stringify(body));
  }
});
