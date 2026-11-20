import assert from "node:assert/strict";
import test from "node:test";
import { mapPriority, parseDue, parseContentLine, parseVTodos, splitEscaped, unescapeText, unfold } from "../src/caldav/ics.ts";

const wrap = (...lines: string[]) => ["BEGIN:VCALENDAR", "BEGIN:VTODO", ...lines, "END:VTODO", "END:VCALENDAR"].join("\r\n");
const one = (...lines: string[]) => {
  const todos = parseVTodos(wrap(...lines));
  assert.equal(todos.length, 1);
  return todos[0];
};

test("unfold joins continuation lines and handles LF and CRLF", () => {
  // One leading space or tab is the fold marker and is removed, any further space belongs to the text.
  assert.deepEqual(unfold("A:1\r\nB:long\r\n  part\r\n\tmore\nC:3\n"), ["A:1", "B:long part" + "more", "C:3"]);
});

test("unescapeText handles backslash, comma, semicolon and newline", () => {
  assert.equal(unescapeText("a\\, b\\; c\\nd\\Ne\\\\f"), "a, b; c\nd\ne\\f");
  assert.equal(unescapeText("keep \\x as is"), "keep \\x as is");
});

test("splitEscaped splits only on unescaped commas", () => {
  assert.deepEqual(splitEscaped("a\\,b,c,,d"), ["a\\,b", "c", "", "d"]);
});

test("parseContentLine reads params, quoted params and a colon inside the value", () => {
  const line = parseContentLine('DUE;TZID="Europe/Berlin";X-A="b;c":20261124T093000');
  assert.equal(line?.name, "DUE");
  assert.equal(line?.params.TZID, "Europe/Berlin");
  assert.equal(line?.params["X-A"], "b;c");
  assert.equal(line?.value, "20261124T093000");
  assert.equal(parseContentLine("SUMMARY:a: b")?.value, "a: b");
  assert.equal(parseContentLine("no colon here"), null);
});

test("DUE as a date and as a TZID date-time, both keep the date as written", () => {
  const date = parseDue(parseContentLine("DUE;VALUE=DATE:20261201")!);
  assert.deepEqual({ ...date, raw: undefined }, { date: "2026-12-01", time: null, tzid: null, utc: false, allDay: true, raw: undefined });
  const tz = parseDue(parseContentLine("DUE;TZID=Europe/Berlin:20261124T093000")!);
  assert.equal(tz?.date, "2026-11-24");
  assert.equal(tz?.time, "09:30:00");
  assert.equal(tz?.tzid, "Europe/Berlin");
  assert.equal(tz?.allDay, false);
  assert.equal(tz?.raw, "DUE;TZID=Europe/Berlin:20261124T093000");
  assert.equal(parseDue(parseContentLine("DUE:20261124T230000Z")!)?.utc, true);
  assert.equal(parseDue(parseContentLine("DUE:garbage")!), null);
});

test("priority buckets: 1/5/9 stay, 0 and absent are unset, others go to the nearest bucket", () => {
  assert.equal(mapPriority(1), 1);
  assert.equal(mapPriority(5), 5);
  assert.equal(mapPriority(9), 9);
  assert.equal(mapPriority(0), null);
  assert.equal(mapPriority(null), null);
  assert.equal(mapPriority(2), 1);
  assert.equal(mapPriority(4), 1);
  assert.equal(mapPriority(6), 9);
  assert.equal(mapPriority(8), 9);
  assert.equal(mapPriority(10), null);
  assert.equal(mapPriority(-3), null);
  assert.equal(one("UID:p", "SUMMARY:x", "PRIORITY:3").rawPriority, 3);
  assert.equal(one("UID:p", "SUMMARY:x").priority, null);
});

test("text fields are unescaped and CATEGORIES keeps an escaped comma inside one tag", () => {
  const todo = one("UID:t1", "SUMMARY:Gutachten lesen\\, kommentieren", "DESCRIPTION:eins\\nzwei", "CATEGORIES:Arbeit\\, intern,Gutachten", "CATEGORIES:Extra");
  assert.equal(todo.summary, "Gutachten lesen, kommentieren");
  assert.equal(todo.description, "eins\nzwei");
  assert.deepEqual(todo.categories, ["Arbeit, intern", "Gutachten", "Extra"]);
  assert.equal(todo.someday, false);
});

test("someday is derived from the category, case-insensitively", () => {
  assert.equal(one("UID:s", "SUMMARY:x", "CATEGORIES:Haushalt,Someday").someday, true);
  assert.equal(one("UID:s", "SUMMARY:x", "CATEGORIES:somedays").someday, false);
});

test("status values are preserved, and a missing STATUS is derived", () => {
  for (const status of ["NEEDS-ACTION", "COMPLETED", "IN-PROCESS", "CANCELLED"]) {
    assert.equal(one("UID:s", "SUMMARY:x", `STATUS:${status}`).status, status);
  }
  assert.equal(one("UID:s", "SUMMARY:x").status, "NEEDS-ACTION");
  assert.equal(one("UID:s", "SUMMARY:x", "PERCENT-COMPLETE:100").status, "COMPLETED");
  assert.equal(one("UID:s", "SUMMARY:x", "COMPLETED:20261105T101500Z").status, "COMPLETED");
  assert.equal(one("UID:s", "SUMMARY:x", "STATUS:WHATEVER").status, "NEEDS-ACTION");
});

test("unknown properties and nested components are kept as raw lines in order", () => {
  const todo = one(
    "UID:u",
    "SUMMARY:x",
    "RELATED-TO;RELTYPE=PARENT:parent-1",
    "X-APPLE-SORT-ORDER:12",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "SUMMARY:alarm text",
    "END:VALARM",
    "DTSTAMP:20261101T080000Z",
  );
  assert.deepEqual(todo.unknownProps, [
    "RELATED-TO;RELTYPE=PARENT:parent-1",
    "X-APPLE-SORT-ORDER:12",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "SUMMARY:alarm text",
    "END:VALARM",
    "DTSTAMP:20261101T080000Z",
  ]);
  // The alarm's SUMMARY did not overwrite the task's.
  assert.equal(todo.summary, "x");
});

test("a VTODO with no UID is skipped, and a calendar with several VTODOs gives several tasks", () => {
  const text = ["BEGIN:VCALENDAR", "BEGIN:VTODO", "SUMMARY:no uid", "END:VTODO", "BEGIN:VTODO", "UID:a", "SUMMARY:A", "END:VTODO", "BEGIN:VEVENT", "UID:e", "SUMMARY:event", "END:VEVENT", "BEGIN:VTODO", "UID:b", "SUMMARY:B", "END:VTODO", "END:VCALENDAR"].join("\n");
  assert.deepEqual(parseVTodos(text).map((todo) => todo.uid), ["a", "b"]);
});
