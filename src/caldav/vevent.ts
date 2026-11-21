// VEVENT writing and reading for the rapid-log event sync (RFC 5545).
//
// An event is written as one VEVENT with the entry id in X-BUJO-ID, wall-clock times in Europe/Berlin, and
// no ATTENDEE, ORGANIZER or DESCRIPTION. A day with no time is an all-day event (VALUE=DATE, next day as
// DTEND, TRANSP:TRANSPARENT). A timed event runs one hour and carries a full VTIMEZONE block.
// An edit keeps every property it does not own, folding included (see openBlock in ics.ts).

import {
  blocksOf,
  categoriesLine,
  escapeText,
  foldLine,
  formatUtc,
  openBlock,
  parseContentLine,
  parseDue,
  splitEscaped,
  summaryLine,
  unescapeText,
  type Due,
  type OpenBlock,
} from "./ics.ts";

export const EVENT_TZID = "Europe/Berlin";

/** What bujo owns on a VEVENT: the entry it stands for, its title, its day, an optional HH:MM and its categories. */
export type EventFields = {
  entryId: string;
  summary: string;
  /** YYYY-MM-DD. */
  date: string;
  /** HH:MM, or null for an all-day event. */
  time: string | null;
  categories: string[];
};

/** What the parser knows from one VEVENT. */
export type VEvent = {
  uid: string;
  summary: string;
  /** Value of X-BUJO-ID, null for an event bujo did not write. */
  entryId: string | null;
  categories: string[];
  /** TRANSP in upper case, null when absent. */
  transp: string | null;
  start: Due | null;
  end: Due | null;
};

/** A wall-clock moment: the day, and HH:MM or null for a whole day. */
export type Point = { date: string; time: string | null };

const pad = (n: number) => String(n).padStart(2, "0");

function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** Start and end of an event: a whole day ends on the next day, a timed event ends one wall-clock hour later. */
export function eventSpan(date: string, time: string | null): { start: Point; end: Point } {
  if (time === null) return { start: { date, time: null }, end: { date: addDays(date, 1), time: null } };
  const [hour, minute] = time.split(":").map(Number);
  const end = hour === 23 ? { date: addDays(date, 1), time: `00:${pad(minute)}` } : { date, time: `${pad(hour + 1)}:${pad(minute)}` };
  return { start: { date, time }, end };
}

/** True when a parsed DTSTART or DTEND says exactly this moment, with the Berlin zone for a timed one. */
export function pointMatches(due: Due | null, point: Point): boolean {
  if (!due || due.date !== point.date) return false;
  if (point.time === null) return due.allDay;
  return !due.allDay && !due.utc && due.tzid === EVENT_TZID && due.time === `${point.time}:00`;
}

/** DTSTART or DTEND with its value type: a date, or a Berlin wall-clock time. */
function pointLine(name: "DTSTART" | "DTEND", point: Point): string {
  const day = point.date.replace(/-/g, "");
  if (point.time === null) return `${name};VALUE=DATE:${day}`;
  return `${name};TZID=${EVENT_TZID}:${day}T${point.time.replace(":", "")}00`;
}

/** The Europe/Berlin VTIMEZONE: CEST from the last Sunday of March 02:00, CET from the last Sunday of October 03:00. */
const VTIMEZONE_LINES = [
  "BEGIN:VTIMEZONE",
  `TZID:${EVENT_TZID}`,
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
];

const xIdLine = (entryId: string) => `X-BUJO-ID:${escapeText(entryId)}`;

/** A whole VCALENDAR with one new VEVENT: CRLF line ends, lines folded at 75 octets. */
export function buildNewEvent(input: EventFields & { uid: string }, nowMs: number): string {
  const stamp = formatUtc(nowMs);
  const { start, end } = eventSpan(input.date, input.time);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//bujo//bujo//EN"];
  if (input.time !== null) lines.push(...VTIMEZONE_LINES);
  lines.push(
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    xIdLine(input.entryId),
    summaryLine(input.summary),
    pointLine("DTSTART", start),
    pointLine("DTEND", end),
  );
  if (input.time === null) lines.push("TRANSP:TRANSPARENT");
  lines.push(categoriesLine(input.categories), "END:VEVENT", "END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}

/** Maps the unfolded lines between BEGIN:VEVENT and END:VEVENT. Null when there is no UID. */
export function mapVEvent(lines: string[]): VEvent | null {
  const event: VEvent = { uid: "", summary: "", entryId: null, categories: [], transp: null, start: null, end: null };
  let nested = 0;
  for (const line of lines) {
    if (/^BEGIN:/i.test(line)) nested++;
    else if (/^END:/i.test(line)) nested--;
    else if (nested === 0) readProp(event, line);
  }
  return event.uid === "" ? null : event;
}

/** Copies one top-level property into the event. The first UID, SUMMARY, DTSTART, DTEND and X-BUJO-ID win. */
function readProp(event: VEvent, line: string): void {
  const prop = parseContentLine(line);
  if (!prop) return;
  if (prop.name === "UID" && event.uid === "") event.uid = prop.value.trim();
  else if (prop.name === "SUMMARY" && event.summary === "") event.summary = unescapeText(prop.value);
  else if (prop.name === "X-BUJO-ID" && event.entryId === null) event.entryId = unescapeText(prop.value).trim();
  else if (prop.name === "TRANSP") event.transp = prop.value.trim().toUpperCase();
  else if (prop.name === "DTSTART" && event.start === null) event.start = parseDue(prop);
  else if (prop.name === "DTEND" && event.end === null) event.end = parseDue(prop);
  else if (prop.name === "CATEGORIES") event.categories.push(...splitEscaped(prop.value).map(unescapeText).filter((tag) => tag !== ""));
}

/** Parses every VEVENT in an iCalendar text. A VEVENT with no UID is skipped, it cannot be addressed. */
export function parseVEvents(ics: string): VEvent[] {
  return blocksOf(ics, "VEVENT").flatMap((lines) => mapVEvent(lines) ?? []);
}

/** The mapped fields where a VEVENT differs from what the fields say: SUMMARY, DTSTART, DTEND, TRANSP (whole day only), CATEGORIES. */
export function eventDifferences(event: VEvent, fields: EventFields): string[] {
  const { start, end } = eventSpan(fields.date, fields.time);
  const out: string[] = [];
  if (event.summary !== fields.summary) out.push("SUMMARY");
  if (!pointMatches(event.start, start)) out.push("DTSTART");
  if (!pointMatches(event.end, end)) out.push("DTEND");
  if (fields.time === null && event.transp !== "TRANSPARENT") out.push("TRANSP");
  if (!sameList(event.categories, fields.categories)) out.push("CATEGORIES");
  return out;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((item, index) => item === b[index]);

/** Adds the Berlin VTIMEZONE before the first VEVENT when the object has none. */
function withTimezone(ics: string): string {
  if (new RegExp(`^TZID:${EVENT_TZID}\\s*$`, "mi").test(ics)) return ics;
  const eol = /\r\n|\n|\r/.exec(ics)?.[0] ?? "\r\n";
  const at = ics.search(/^BEGIN:VEVENT/im);
  if (at < 0) return ics;
  return ics.slice(0, at) + VTIMEZONE_LINES.join(eol) + eol + ics.slice(at);
}

/**
 * Edits the VEVENT with this UID so it says what the fields say, and keeps every other property as it was.
 * Returns null when the object has no such VEVENT. A change that is already in place returns `changed: false`
 * and the text as it came in, so the caller can skip the write.
 */
export function editEvent(ics: string, uid: string, fields: EventFields, nowMs: number): { ics: string; changed: boolean } | null {
  const block = openBlock(ics, "VEVENT", uid);
  const current = block ? mapVEvent(block.lines) : null;
  if (!block || !current) return null;
  const differences = eventDifferences(current, fields);
  if (differences.length === 0) return { ics, changed: false };
  if (differences.includes("SUMMARY")) block.setProp("SUMMARY", summaryLine(fields.summary));
  if (differences.some((name) => name === "DTSTART" || name === "DTEND" || name === "TRANSP")) setWhen(block, fields);
  if (differences.includes("CATEGORIES")) block.setProp("CATEGORIES", categoriesLine(fields.categories));
  const edited = block.finish(nowMs);
  return { ics: fields.time === null ? edited : withTimezone(edited), changed: true };
}

/** Writes the start, the end and TRANSP for the fields. A DURATION is dropped, since the end is explicit. */
function setWhen(block: OpenBlock, fields: EventFields): void {
  const { start, end } = eventSpan(fields.date, fields.time);
  block.setProp("DTSTART", pointLine("DTSTART", start));
  block.setProp("DTEND", pointLine("DTEND", end));
  block.setProp("DURATION", null);
  block.setProp("TRANSP", fields.time === null ? "TRANSP:TRANSPARENT" : null);
}
