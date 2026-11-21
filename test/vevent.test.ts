import assert from "node:assert/strict";
import test from "node:test";
import { buildNewEvent, editEvent, eventDifferences, eventSpan, mapVEvent, parseVEvents, type EventFields } from "../src/caldav/vevent.ts";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const UID = "11111111-2222-3333-4444-555555555555";
const ENTRY = "entry-id-1";

const fields = (patch: Partial<EventFields> = {}): EventFields => ({
  entryId: ENTRY,
  summary: "Zahnarzt",
  date: "2026-11-24",
  time: null,
  categories: ["bujo"],
  ...patch,
});

/** The unfolded lines of a new event. */
const linesOf = (patch: Partial<EventFields> = {}): string[] => buildNewEvent({ ...fields(patch), uid: UID }, NOW).replace(/\r\n /g, "").split("\r\n");

test("all-day: DTSTART and DTEND are dates, DTEND is the next day, TRANSP is TRANSPARENT, no VTIMEZONE", () => {
  const lines = linesOf();
  assert.ok(lines.includes("DTSTART;VALUE=DATE:20261124"));
  assert.ok(lines.includes("DTEND;VALUE=DATE:20261125"));
  assert.ok(lines.includes("TRANSP:TRANSPARENT"));
  assert.equal(lines.includes("BEGIN:VTIMEZONE"), false);
  assert.equal(lines.some((line) => line.startsWith("DURATION")), false);
});

test("all-day: the next day crosses a month and a year end", () => {
  assert.ok(linesOf({ date: "2026-11-30" }).includes("DTEND;VALUE=DATE:20261201"));
  assert.ok(linesOf({ date: "2026-12-31" }).includes("DTEND;VALUE=DATE:20270101"));
  assert.ok(linesOf({ date: "2028-02-28" }).includes("DTEND;VALUE=DATE:20280229"));
});

test("timed: TZID Europe/Berlin wall-clock start, an explicit end one hour later, no DURATION, no TRANSP", () => {
  const lines = linesOf({ time: "13:00" });
  assert.ok(lines.includes("DTSTART;TZID=Europe/Berlin:20261124T130000"), "13:00 stays 13:00, not converted to UTC");
  assert.ok(lines.includes("DTEND;TZID=Europe/Berlin:20261124T140000"));
  assert.equal(lines.some((line) => line.startsWith("DURATION")), false);
  assert.equal(lines.some((line) => line.startsWith("TRANSP")), false);
  assert.equal(lines.some((line) => /^DT(START|END).*Z$/.test(line)), false, "nothing is written in UTC");
});

test("timed: a late event ends after midnight on the next day", () => {
  const lines = linesOf({ time: "23:30" });
  assert.ok(lines.includes("DTSTART;TZID=Europe/Berlin:20261124T233000"));
  assert.ok(lines.includes("DTEND;TZID=Europe/Berlin:20261125T003000"));
  assert.deepEqual(eventSpan("2026-11-24", "00:00"), { start: { date: "2026-11-24", time: "00:00" }, end: { date: "2026-11-24", time: "01:00" } });
});

test("timed: the full Europe/Berlin VTIMEZONE is in the object, CEST and CET rules, once, before the VEVENT", () => {
  const lines = linesOf({ time: "09:15" });
  const block = lines.slice(lines.indexOf("BEGIN:VTIMEZONE"), lines.indexOf("END:VTIMEZONE") + 1);
  assert.deepEqual(block, [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
  ]);
  assert.equal(lines.filter((line) => line === "BEGIN:VTIMEZONE").length, 1);
  assert.ok(lines.indexOf("END:VTIMEZONE") < lines.indexOf("BEGIN:VEVENT"));
});

test("required and owned properties: UID, DTSTAMP, SUMMARY, X-BUJO-ID, CATEGORIES, and never ATTENDEE, ORGANIZER or DESCRIPTION", () => {
  for (const time of [null, "13:00"]) {
    const lines = linesOf({ time });
    assert.ok(lines.includes(`UID:${UID}`));
    assert.ok(lines.includes("DTSTAMP:20261120T100000Z"));
    assert.ok(lines.includes("SUMMARY:Zahnarzt"));
    assert.ok(lines.includes(`X-BUJO-ID:${ENTRY}`));
    assert.ok(lines.includes("CATEGORIES:bujo"));
    for (const name of ["ATTENDEE", "ORGANIZER", "DESCRIPTION"]) assert.equal(lines.some((line) => line.startsWith(name)), false, name);
    assert.equal(lines.filter((line) => line === "BEGIN:VEVENT").length, 1);
    assert.equal(lines.some((line) => line.startsWith("BEGIN:VTODO")), false);
  }
});

test("a tag is an extra category, and category text is escaped like other ICS text", () => {
  assert.ok(linesOf({ categories: ["bujo", "Arzt"] }).includes("CATEGORIES:bujo,Arzt"));
  assert.ok(linesOf({ categories: ["bujo", "a,b;c"] }).includes("CATEGORIES:bujo,a\\,b\\;c"));
  const [event] = parseVEvents(buildNewEvent({ ...fields({ categories: ["bujo", "a,b;c"] }), uid: UID }, NOW));
  assert.deepEqual(event.categories, ["bujo", "a,b;c"]);
});

test("German text and umlauts stay intact through folding and a parse", () => {
  const title = "Übergabe für die Hausverwaltung Müller & Söhne mit allen Schlüsseln und Zählerständen klären";
  const raw = buildNewEvent({ ...fields({ summary: title, categories: ["bujo", "Größe"] }), uid: UID }, NOW);
  assert.ok(raw.includes("\r\n "), "a long title is folded");
  assert.equal(Buffer.from(raw, "utf8").toString("utf8"), raw);
  const [event] = parseVEvents(raw);
  assert.equal(event.summary, title);
  assert.deepEqual(event.categories, ["bujo", "Größe"]);
  for (const physical of raw.split("\r\n")) assert.ok(Buffer.byteLength(physical) <= 75, "a line is at most 75 octets");
});

test("parse: UID, entry id, times with their zone, TRANSP", () => {
  const [event] = parseVEvents(buildNewEvent({ ...fields({ time: "13:00" }), uid: UID }, NOW));
  assert.equal(event.uid, UID);
  assert.equal(event.entryId, ENTRY);
  assert.equal(event.start?.tzid, "Europe/Berlin");
  assert.equal(event.start?.time, "13:00:00");
  assert.equal(event.end?.time, "14:00:00");
  const [allDay] = parseVEvents(buildNewEvent({ ...fields(), uid: UID }, NOW));
  assert.equal(allDay.start?.allDay, true);
  assert.equal(allDay.transp, "TRANSPARENT");
});

test("parse: a VEVENT with no X-BUJO-ID has a null entry id, one with no UID is skipped, a VTODO is not an event", () => {
  const foreign = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "UID:other", "SUMMARY:Fremd", "DTSTART;VALUE=DATE:20261124", "END:VEVENT", "BEGIN:VEVENT", "SUMMARY:no uid", "END:VEVENT", "BEGIN:VTODO", "UID:t", "END:VTODO", "END:VCALENDAR"].join("\r\n");
  const events = parseVEvents(foreign);
  assert.equal(events.length, 1);
  assert.equal(events[0].entryId, null);
  assert.equal(mapVEvent(["SUMMARY:x"]), null);
});

test("differences: names each mapped field that is off, and nothing when it matches", () => {
  const good = parseVEvents(buildNewEvent({ ...fields(), uid: UID }, NOW))[0];
  assert.deepEqual(eventDifferences(good, fields()), []);
  assert.deepEqual(eventDifferences(good, fields({ summary: "Anders" })), ["SUMMARY"]);
  assert.deepEqual(eventDifferences(good, fields({ categories: ["bujo", "x"] })), ["CATEGORIES"]);
  assert.deepEqual(eventDifferences(good, fields({ date: "2026-11-25" })), ["DTSTART", "DTEND"]);
  assert.deepEqual(eventDifferences(good, fields({ time: "10:00" })), ["DTSTART", "DTEND"]);
  const timed = parseVEvents(buildNewEvent({ ...fields({ time: "10:00" }), uid: UID }, NOW))[0];
  assert.deepEqual(eventDifferences(timed, fields({ time: null })), ["DTSTART", "DTEND", "TRANSP"]);
});

// ----- editing an existing object -----

const FOREIGN_EDITED = (base: string) =>
  base.replace("END:VEVENT", ["LOCATION:Praxis\\, Hauptstraße 1", "X-OTHER-FLAG;X-P=1:keep me", "DESCRIPTION:Notiz von anderswo", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "END:VALARM", "END:VEVENT"].join("\r\n"));

test("edit: a title change keeps unknown properties, the alarm and the folding of untouched lines", () => {
  const base = FOREIGN_EDITED(buildNewEvent({ ...fields({ time: "13:00" }), uid: UID }, NOW));
  const edited = editEvent(base, UID, fields({ time: "13:00", summary: "Zahnarzt Kontrolle" }), NOW + 5000)!;
  assert.equal(edited.changed, true);
  for (const kept of ["LOCATION:Praxis\\, Hauptstraße 1", "X-OTHER-FLAG;X-P=1:keep me", "DESCRIPTION:Notiz von anderswo", "BEGIN:VALARM", "TRIGGER:-PT15M", `X-BUJO-ID:${ENTRY}`, "BEGIN:VTIMEZONE"]) {
    assert.ok(edited.ics.includes(kept), `lost ${kept}`);
  }
  assert.ok(edited.ics.includes("SUMMARY:Zahnarzt Kontrolle"));
  assert.ok(edited.ics.includes("SEQUENCE:1"));
  assert.ok(edited.ics.includes("LAST-MODIFIED:20261120T100005Z"));
});

test("edit: nothing to change reports changed: false and the same text", () => {
  const base = buildNewEvent({ ...fields(), uid: UID }, NOW);
  const same = editEvent(base, UID, fields(), NOW + 1000)!;
  assert.equal(same.changed, false);
  assert.equal(same.ics, base);
});

test("edit: all-day to timed adds the VTIMEZONE, drops TRANSP, and timed back to all-day restores both", () => {
  const allDay = buildNewEvent({ ...fields(), uid: UID }, NOW);
  const timed = editEvent(allDay, UID, fields({ time: "08:30" }), NOW + 1000)!;
  assert.ok(timed.ics.includes("DTSTART;TZID=Europe/Berlin:20261124T083000"));
  assert.ok(timed.ics.includes("DTEND;TZID=Europe/Berlin:20261124T093000"));
  assert.ok(timed.ics.includes("TZID:Europe/Berlin\r\n"));
  assert.equal(timed.ics.includes("TRANSP"), false);
  assert.equal(timed.ics.includes("DTSTART;VALUE=DATE"), false);
  assert.deepEqual(eventDifferences(parseVEvents(timed.ics)[0], fields({ time: "08:30" })), []);

  const back = editEvent(timed.ics, UID, fields(), NOW + 2000)!;
  assert.ok(back.ics.includes("DTSTART;VALUE=DATE:20261124"));
  assert.ok(back.ics.includes("DTEND;VALUE=DATE:20261125"));
  assert.ok(back.ics.includes("TRANSP:TRANSPARENT"));
  assert.deepEqual(eventDifferences(parseVEvents(back.ics)[0], fields()), []);
});

test("edit: a DURATION on the object is replaced by the explicit end, and a day move changes both ends", () => {
  const base = buildNewEvent({ ...fields({ time: "13:00" }), uid: UID }, NOW)
    .replace(/DTEND;.*\r\n/, "DURATION:PT2H\r\n");
  const edited = editEvent(base, UID, fields({ time: "13:00", date: "2026-11-26" }), NOW + 1000)!;
  assert.equal(edited.ics.includes("DURATION"), false);
  assert.ok(edited.ics.includes("DTSTART;TZID=Europe/Berlin:20261126T130000"));
  assert.ok(edited.ics.includes("DTEND;TZID=Europe/Berlin:20261126T140000"));
});

test("edit: the tag changes only CATEGORIES, and removing the tag leaves bujo", () => {
  const base = buildNewEvent({ ...fields({ categories: ["bujo", "Arzt"] }), uid: UID }, NOW);
  const none = editEvent(base, UID, fields(), NOW + 1000)!;
  assert.ok(none.ics.includes("CATEGORIES:bujo\r\n"));
  assert.equal(none.ics.includes("Arzt"), false);
  assert.equal(none.ics.includes("SUMMARY:Zahnarzt\r\n"), true);
});

test("edit: an object with no VEVENT of that UID answers null, so the caller reports it gone", () => {
  const base = buildNewEvent({ ...fields(), uid: UID }, NOW);
  assert.equal(editEvent(base, "another-uid", fields(), NOW), null);
});
