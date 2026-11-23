import assert from "node:assert/strict";
import test from "node:test";
import { editTodo, parseVTodos } from "../src/caldav/ics.ts";
import { loadSyncConfig } from "../src/sync/config.ts";
import { isLiveList, writeRefusal } from "../src/sync/guard.ts";
import { isSyncable, newTodoFor, patchFor, readBackMismatch, syncKind, todoShape } from "../src/sync/mapping.ts";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const UID = "fresh-uid-1";
const entry = (type: Parameters<typeof todoShape>[0]["type"], title = "Brot kaufen", date = "2026-11-24") => ({ type, title, date });

/** The ICS a new entry of this type produces, as unfolded lines. */
function icsOf(type: Parameters<typeof todoShape>[0]["type"], title?: string): string[] {
  return newTodoFor(todoShape(entry(type, title)), UID, NOW).replace(/\r\n /g, "").split("\r\n");
}

test("task: open, no DUE", () => {
  const lines = icsOf("task");
  assert.ok(lines.includes("STATUS:NEEDS-ACTION"));
  assert.ok(lines.includes("SUMMARY:Brot kaufen"));
  assert.ok(lines.includes(`UID:${UID}`));
  assert.equal(lines.some((line) => line.startsWith("DUE") || line.startsWith("COMPLETED") || line.startsWith("PERCENT-COMPLETE")), false);
});

test("done: COMPLETED with a UTC timestamp and PERCENT-COMPLETE 100", () => {
  const lines = icsOf("done");
  assert.ok(lines.includes("STATUS:COMPLETED"));
  assert.ok(lines.includes("COMPLETED:20261120T100000Z"));
  assert.ok(lines.includes("PERCENT-COMPLETE:100"));
  assert.equal(lines.some((line) => line.startsWith("DUE")), false);
});

test("migrated: still open, no DUE (moved forward, not done)", () => {
  const lines = icsOf("migrated");
  assert.ok(lines.includes("STATUS:NEEDS-ACTION"));
  assert.equal(lines.some((line) => line.startsWith("DUE") || line.startsWith("COMPLETED")), false);
});

test("scheduled: open with DUE;VALUE=DATE of the entry's day", () => {
  const lines = icsOf("scheduled");
  assert.ok(lines.includes("STATUS:NEEDS-ACTION"));
  assert.ok(lines.includes("DUE;VALUE=DATE:20261124"));
  assert.equal(lines.filter((line) => line.startsWith("DUE")).length, 1);
});

test("a month or future task, done or migrated entry has DUE = the last day of its month, a plain daily task has none", () => {
  for (const horizon of ["month-task", "future"] as const) {
    for (const type of ["task", "done", "migrated"] as const) {
      assert.equal(todoShape({ type, title: "t", date: "2026-12-31", horizon }).due, "2026-12-31", `${horizon} ${type}`);
    }
  }
  const due = newTodoFor(todoShape({ type: "task", title: "t", date: "2026-12-31", horizon: "future" }), UID, NOW).split("\r\n");
  assert.ok(due.includes("DUE;VALUE=DATE:20261231"));
  for (const type of ["task", "done", "migrated"] as const) {
    assert.equal(todoShape({ type, title: "t", date: "2026-12-31", horizon: "day" }).due, null, `day ${type}`);
    assert.equal(todoShape({ type, title: "t", date: "2026-12-31" }).due, null, `no horizon ${type}`);
  }
  assert.equal(todoShape({ type: "scheduled", title: "t", date: "2026-12-14", horizon: "day" }).due, "2026-12-14");
  for (const type of ["task", "done", "migrated"] as const) {
    assert.equal(todoShape({ type, title: "t", date: "2026-12-14", horizon: "month-calendar" }).due, null, `month-calendar ${type}`);
  }
  assert.equal(todoShape({ type: "scheduled", title: "t", date: "2026-12-14", horizon: "month-calendar" }).due, "2026-12-14");
});

test("dropped: STATUS:CANCELLED as a VTODO, no COMPLETED, no DUE on a day", () => {
  const lines = icsOf("dropped");
  assert.ok(lines.includes("STATUS:CANCELLED"));
  assert.ok(lines.includes(`UID:${UID}`));
  assert.equal(lines.some((line) => line.startsWith("DUE") || line.startsWith("COMPLETED") || line.startsWith("PERCENT-COMPLETE") || line === "STATUS:COMPLETED"), false);
  assert.equal(todoShape(entry("dropped")).status, "CANCELLED");
  assert.equal(syncKind("dropped"), "todo");
});

test("a new VTODO never has DTSTART, PRIORITY or CATEGORIES, whatever the type", () => {
  for (const type of ["task", "done", "migrated", "scheduled", "dropped"] as const) {
    const lines = icsOf(type);
    for (const name of ["DTSTART", "PRIORITY", "CATEGORIES"]) assert.equal(lines.some((line) => line.startsWith(name)), false, `${type} wrote ${name}`);
    assert.equal(lines.filter((line) => line === "BEGIN:VTODO").length, 1);
    assert.equal(lines.some((line) => line.startsWith("BEGIN:VEVENT")), false);
  }
});

test("task, event, done, migrated, scheduled and dropped sync: notes do not", () => {
  assert.deepEqual(
    (["task", "note", "event", "done", "migrated", "scheduled", "dropped"] as const).filter(isSyncable),
    ["task", "event", "done", "migrated", "scheduled", "dropped"],
  );
  assert.equal(syncKind("event"), "event");
  assert.equal(syncKind("note"), null);
  for (const type of ["task", "done", "migrated", "scheduled", "dropped"] as const) assert.equal(syncKind(type), "todo", type);
});

test("umlauts survive in SUMMARY, through folding and a parse", () => {
  const title = "Müller anrufen für Übergabe";
  const raw = newTodoFor(todoShape(entry("task", title)), UID, NOW);
  assert.ok(Buffer.from(raw, "utf8").toString("utf8").includes(`SUMMARY:${title}`));
  assert.equal(parseVTodos(raw)[0].summary, title);
  const long = "Übergabe für die Hausverwaltung Müller & Söhne mit allen Schlüsseln und Zählerständen klären";
  const folded = newTodoFor(todoShape(entry("task", long)), UID, NOW);
  assert.ok(folded.includes("\r\n "), "a long title is folded");
  assert.equal(parseVTodos(folded)[0].summary, long);
});

const REMOTE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//other//client//EN",
  "BEGIN:VTODO",
  `UID:${UID}`,
  "DTSTAMP:20261101T080000Z",
  "SUMMARY:Alter Titel",
  "STATUS:NEEDS-ACTION",
  "PRIORITY:5",
  "CATEGORIES:Haushalt",
  "DESCRIPTION:Notiz von anderswo",
  "X-OTHER-FLAG;X-P=1:keep me",
  "RELATED-TO:parent-1",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "END:VALARM",
  "END:VTODO",
  "END:VCALENDAR",
  "",
].join("\r\n");

test("an edit keeps unknown properties, the alarm, priority, categories and description", () => {
  const edited = editTodo(REMOTE, UID, patchFor(todoShape(entry("scheduled", "Neuer Titel", "2026-12-01"))), NOW);
  assert.equal(edited.changed, true);
  for (const kept of ["X-OTHER-FLAG;X-P=1:keep me", "RELATED-TO:parent-1", "BEGIN:VALARM", "TRIGGER:-PT15M", "PRIORITY:5", "CATEGORIES:Haushalt", "DESCRIPTION:Notiz von anderswo"]) {
    assert.ok(edited.ics.includes(kept), `lost ${kept}`);
  }
  assert.ok(edited.ics.includes("SUMMARY:Neuer Titel"));
  assert.ok(edited.ics.includes("DUE;VALUE=DATE:20261201"));
  assert.equal(edited.ics.includes("DTSTART"), false);
});

test("an edit to done completes it, and back to task reopens it and drops COMPLETED and PERCENT-COMPLETE", () => {
  const done = editTodo(REMOTE, UID, patchFor(todoShape(entry("done", "Alter Titel"))), NOW);
  assert.ok(done.ics.includes("STATUS:COMPLETED"));
  assert.ok(done.ics.includes("COMPLETED:20261120T100000Z"));
  assert.ok(done.ics.includes("PERCENT-COMPLETE:100"));

  const reopened = editTodo(done.ics, UID, patchFor(todoShape(entry("task", "Alter Titel"))), NOW + 1000);
  assert.equal(reopened.changed, true);
  assert.ok(reopened.ics.includes("STATUS:NEEDS-ACTION"));
  assert.equal(reopened.ics.includes("COMPLETED:"), false);
  assert.equal(reopened.ics.includes("PERCENT-COMPLETE"), false);
  assert.ok(reopened.ics.includes("X-OTHER-FLAG;X-P=1:keep me"));
});

test("an edit to dropped cancels it (not COMPLETED), keeps the other properties, and back to task reopens it", () => {
  const done = editTodo(REMOTE, UID, patchFor(todoShape(entry("done", "Alter Titel"))), NOW);
  const dropped = editTodo(done.ics, UID, patchFor(todoShape(entry("dropped", "Alter Titel"))), NOW + 1000);
  assert.equal(dropped.changed, true);
  assert.ok(dropped.ics.includes("STATUS:CANCELLED"));
  assert.equal(dropped.ics.includes("STATUS:COMPLETED"), false);
  assert.equal(dropped.ics.includes("COMPLETED:"), false);
  assert.equal(dropped.ics.includes("PERCENT-COMPLETE"), false);
  assert.ok(dropped.ics.includes("X-OTHER-FLAG;X-P=1:keep me"));
  assert.equal(editTodo(dropped.ics, UID, patchFor(todoShape(entry("dropped", "Alter Titel"))), NOW + 2000).changed, false);
  const reopened = editTodo(dropped.ics, UID, patchFor(todoShape(entry("task", "Alter Titel"))), NOW + 3000);
  assert.ok(reopened.ics.includes("STATUS:NEEDS-ACTION"));
});

test("readBackMismatch says STATUS when a dropped entry reads back as open or completed", () => {
  const shape = todoShape(entry("dropped"));
  const good = newTodoFor(shape, UID, NOW);
  assert.equal(readBackMismatch(good, UID, shape), null);
  assert.match(readBackMismatch(good.replace("CANCELLED", "COMPLETED"), UID, shape)!, /STATUS/);
  assert.match(readBackMismatch(good.replace("CANCELLED", "NEEDS-ACTION"), UID, shape)!, /STATUS/);
});

test("an edit that changes nothing reports changed: false, so no write goes out", () => {
  const same = editTodo(REMOTE, UID, patchFor(todoShape(entry("task", "Alter Titel"))), NOW);
  assert.equal(same.changed, false);
  assert.equal(same.ics, REMOTE);
});

test("moving scheduled to task removes the DUE", () => {
  const scheduled = editTodo(REMOTE, UID, patchFor(todoShape(entry("scheduled", "Alter Titel", "2026-12-01"))), NOW);
  const task = editTodo(scheduled.ics, UID, patchFor(todoShape(entry("task", "Alter Titel"))), NOW + 1000);
  assert.equal(task.ics.includes("DUE"), false);
});

test("readBackMismatch compares UID, SUMMARY, STATUS and DUE", () => {
  const shape = todoShape(entry("scheduled", "Müller anrufen", "2026-11-24"));
  const good = newTodoFor(shape, UID, NOW);
  assert.equal(readBackMismatch(good, UID, shape), null);
  assert.match(readBackMismatch(good, "other-uid", shape)!, /UID/);
  assert.match(readBackMismatch(good.replace("Müller", "Mueller"), UID, shape)!, /SUMMARY/);
  assert.match(readBackMismatch(good.replace("NEEDS-ACTION", "COMPLETED"), UID, shape)!, /STATUS/);
  assert.match(readBackMismatch(good.replace("20261124", "20261125"), UID, shape)!, /DUE/);
  assert.match(readBackMismatch(good.replace(/DUE.*\r\n/, ""), UID, shape)!, /DUE/);
});

// ----- the hard guard -----

const LISTS = [
  { name: "Aufgaben", path: "/remote.php/dav/calendars/admin/tasks/" },
  { name: "Arbeit", path: "/remote.php/dav/calendars/admin/arbeit/" },
  { name: "bujo-test", path: "/remote.php/dav/calendars/admin/bujo-test/" },
];
const OFF = { live: false };

test("guard: the test list is allowed", () => {
  assert.equal(writeRefusal(LISTS[2], LISTS, OFF), null);
});

test("guard: Aufgaben and Arbeit are refused by name, in any case", () => {
  for (const name of ["Aufgaben", "Arbeit", "aufgaben", "ARBEIT", " Arbeit "]) {
    const message = writeRefusal({ name, path: "/dav/other/" }, LISTS, OFF);
    assert.ok(message, `${name} was allowed`);
    assert.match(message, /switched off/);
  }
});

test("guard: a list under another name is refused when its path is a live list's path", () => {
  assert.ok(writeRefusal({ name: "mine", path: LISTS[0].path }, LISTS, OFF));
  assert.ok(writeRefusal({ name: "mine", path: LISTS[1].path.toUpperCase() }, LISTS, OFF));
  assert.ok(writeRefusal({ name: "mine", path: `http://cloud.example.com${LISTS[0].path}` }, LISTS, OFF), "an absolute URL to the same path");
  assert.ok(writeRefusal({ name: "mine", path: LISTS[0].path.slice(0, -1) }, LISTS, OFF), "no trailing slash");
});

test("guard: a path that ends in /tasks/, /aufgaben/ or /arbeit/ is refused, even with no live list configured", () => {
  for (const path of ["/dav/calendars/x/tasks/", "/dav/calendars/x/tasks", "/dav/calendars/x/Aufgaben/", "/dav/calendars/x/arbeit/", "/dav/calendars/x/%41rbeit/"]) {
    assert.ok(writeRefusal({ name: "bujo-test", path }, [], OFF), `${path} was allowed`);
  }
  assert.equal(isLiveList({ name: "bujo-test", path: "/dav/calendars/x/tasks-test/" }, []), false);
  assert.equal(isLiveList({ name: "bujo-test", path: "/dav/calendars/arbeit/bujo-test/" }, []), false, "arbeit only counts as the last segment");
});

test("guard: BUJO_LIVE_SYNC=1 lifts it, and nothing else does", () => {
  assert.equal(loadSyncConfig({ BUJO_LIVE_SYNC: "1" }).live, true);
  for (const value of [undefined, "", "0", "true", "yes", "2"]) assert.equal(loadSyncConfig({ BUJO_LIVE_SYNC: value }).live, false, String(value));
  assert.equal(writeRefusal(LISTS[0], LISTS, { live: true }), null);
  assert.equal(writeRefusal(LISTS[1], LISTS, { live: true }), null);
});

test("sync config: BUJO_SYNC_LIST defaults to bujo-test", () => {
  assert.equal(loadSyncConfig({}).listName, "bujo-test");
  assert.equal(loadSyncConfig({ BUJO_SYNC_LIST: "  scratch " }).listName, "scratch");
  assert.equal(loadSyncConfig({ BUJO_SYNC_LIST: "" }).listName, "bujo-test");
});

test("important: a new VTODO carries PRIORITY:1, a plain one has no PRIORITY at all", () => {
  const important = newTodoFor(todoShape({ ...entry("task"), important: true }), UID, NOW).replace(/\r\n /g, "").split("\r\n");
  assert.ok(important.includes("PRIORITY:1"));
  assert.equal(icsOf("task").some((line) => line.startsWith("PRIORITY")), false);
  const done = newTodoFor(todoShape({ ...entry("done"), important: true }), UID, NOW).split("\r\n");
  assert.ok(done.includes("PRIORITY:1") && done.includes("STATUS:COMPLETED"));
  const dropped = newTodoFor(todoShape({ ...entry("dropped"), important: true }), UID, NOW).split("\r\n");
  assert.ok(dropped.includes("PRIORITY:1") && dropped.includes("STATUS:CANCELLED"));
});

test("important: an edit sets PRIORITY:1 over a remote 5, and clearing removes a remote 1 but leaves a 5 or 9", () => {
  const set = editTodo(REMOTE, UID, patchFor(todoShape({ ...entry("task", "Alter Titel"), important: true }), 5), NOW);
  assert.ok(set.ics.includes("PRIORITY:1") && !set.ics.includes("PRIORITY:5"));
  const cleared = editTodo(set.ics, UID, patchFor(todoShape(entry("task", "Alter Titel")), 1), NOW + 1000);
  assert.equal(cleared.ics.includes("PRIORITY"), false);
  assert.ok(cleared.ics.includes("CATEGORIES:Haushalt"));
  const kept = editTodo(REMOTE, UID, patchFor(todoShape(entry("task", "Neu")), 5), NOW);
  assert.ok(kept.ics.includes("PRIORITY:5"));
});

test("important: readBackMismatch says PRIORITY when the server did not keep it", () => {
  const shape = todoShape({ ...entry("task"), important: true });
  const good = newTodoFor(shape, UID, NOW);
  assert.equal(readBackMismatch(good, UID, shape), null);
  assert.match(readBackMismatch(good.replace("PRIORITY:1", "PRIORITY:5"), UID, shape)!, /PRIORITY/);
  assert.match(readBackMismatch(good, UID, todoShape(entry("task")))!, /PRIORITY/);
});
