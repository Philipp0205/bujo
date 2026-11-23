// ICS (RFC 5545) VTODO parser and mapper to the Task type used by bujo.
//
// Writing (bottom of this file): buildNewTodo makes a fresh VTODO, editTodo changes only the edited
// properties of an existing one and keeps every other line as it was, folding included.
//
// Mapping choices (see docs/brief.md, "CalDAV mapping"):
//
//  - STATUS keeps the four VTODO values: NEEDS-ACTION, COMPLETED, IN-PROCESS, CANCELLED.
//    A missing STATUS is derived: a COMPLETED timestamp or PERCENT-COMPLETE:100 means COMPLETED,
//    anything else is NEEDS-ACTION (the RFC default). An unknown STATUS value is treated as NEEDS-ACTION.
//  - PRIORITY: the app uses 1 high, 5 medium, 9 low, 0 or absent unset. Other values follow the RFC bands:
//    1-4 map to high (1), 5 to medium (5), 6-9 to low (9). Anything else (negative, above 9, not a number)
//    is unset. The number found in the file stays in `rawPriority`, so an edit can leave it alone.
//  - DUE keeps its own date. For `DUE;VALUE=DATE:20260612` and for `DUE;TZID=Europe/Berlin:20260612T170000`
//    `due.date` is the calendar date as written (no time zone conversion). `due.raw` is the unfolded line,
//    so a later edit that does not change the date can write it back as it was.
//  - CATEGORIES is a comma list where `\,` is a comma inside a tag. Several CATEGORIES lines are merged.
//    `someday` is true when a category equals "someday" (case-insensitive).
//  - Everything that is not mapped (DTSTAMP, CREATED, RELATED-TO, DTSTART, X-*, nested VALARM blocks, ...)
//    is kept as raw unfolded lines in `unknownProps`, in file order.

export type TaskStatus = "NEEDS-ACTION" | "COMPLETED" | "IN-PROCESS" | "CANCELLED";
export type Priority = 1 | 5 | 9;

export type Due = {
  /** Calendar date as written, YYYY-MM-DD. */
  date: string;
  /** HH:MM:SS as written, null for an all-day (VALUE=DATE) due. */
  time: string | null;
  /** TZID parameter, null for dates, UTC and floating times. */
  tzid: string | null;
  /** True for a time that ends in Z. */
  utc: boolean;
  allDay: boolean;
  /** The unfolded DUE line, unchanged. */
  raw: string;
};

/** What the parser knows from one VTODO. The client adds list, href and etag. */
export type VTodo = {
  uid: string;
  summary: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority | null;
  rawPriority: number | null;
  due: Due | null;
  categories: string[];
  someday: boolean;
  percentComplete: number | null;
  /** Value of the COMPLETED property as written (a UTC timestamp), null if absent. */
  completed: string | null;
  /** Unfolded lines of every property and nested component that is not mapped above, in file order. */
  unknownProps: string[];
};

export type Task = VTodo & {
  /** Name of the list (Aufgaben, Arbeit) the task came from. */
  list: string;
  /** URL of the .ics resource. */
  href: string;
  etag: string | null;
};

export type ContentLine = {
  name: string;
  params: Record<string, string>;
  value: string;
  raw: string;
};

const STATUSES: readonly TaskStatus[] = ["NEEDS-ACTION", "COMPLETED", "IN-PROCESS", "CANCELLED"];

export function isOpen(task: Pick<VTodo, "status">): boolean {
  return task.status === "NEEDS-ACTION" || task.status === "IN-PROCESS";
}

/** Splits text into lines and joins folded ones (a line that starts with a space or tab continues the one before). */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter((line) => line !== "");
}

/** Splits on `sep` outside double quotes. */
function splitOutsideQuotes(text: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === sep && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** NAME;PARAM=value;PARAM="a;b":value. Returns null for a line with no colon. */
export function parseContentLine(line: string): ContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [rawName, ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ";");
  const params: Record<string, string> = {};
  for (const part of rawParams) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"(.*)"$/, "$1");
  }
  return { name: rawName.toUpperCase(), params, value: line.slice(colon + 1), raw: line };
}

/** Undoes TEXT escaping: \\ \, \; and \n (or \N). Any other backslash pair is left as it is. */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

/** Splits a TEXT list on commas that are not escaped. The pieces are still escaped. */
export function splitEscaped(value: string, sep = ","): string[] {
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && i + 1 < value.length) {
      current += char + value[i + 1];
      i++;
    } else if (char === sep) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** Parses the value of a DUE line. Accepts a date, a local or TZID date-time, and a UTC date-time. */
export function parseDue(line: ContentLine): Due | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(line.value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  const date = `${year}-${month}-${day}`;
  if (hour === undefined) {
    return { date, time: null, tzid: null, utc: false, allDay: true, raw: line.raw };
  }
  return {
    date,
    time: `${hour}:${minute}:${second}`,
    tzid: line.params.TZID ?? null,
    utc: zulu === "Z",
    allDay: false,
    raw: line.raw,
  };
}

/** 1-4 high, 5 medium, 6-9 low, 0 and everything else unset. */
export function mapPriority(raw: number | null): Priority | null {
  if (raw === null || !Number.isInteger(raw)) return null;
  if (raw >= 1 && raw <= 4) return 1;
  if (raw === 5) return 5;
  if (raw >= 6 && raw <= 9) return 9;
  return null;
}

/** The unfolded lines between BEGIN:<component> and its END, for every such component of a calendar text. Nested blocks stay inside. */
export function blocksOf(ics: string, component: string): string[][] {
  const begin = `BEGIN:${component}`;
  const end = `END:${component}`;
  const blocks: string[][] = [];
  let lines: string[] | null = null;
  let depth = 0;
  for (const line of unfold(ics)) {
    const upper = line.toUpperCase();
    if (lines === null) {
      if (upper === begin) {
        lines = [];
        depth = 0;
      }
      continue;
    }
    if (upper.startsWith("BEGIN:")) depth++;
    if (upper === end && depth === 0) {
      blocks.push(lines);
      lines = null;
      continue;
    }
    if (upper.startsWith("END:") && depth > 0) depth--;
    lines.push(line);
  }
  return blocks;
}

/** Parses every VTODO in an iCalendar text. A VTODO with no UID is skipped, it cannot be addressed. */
export function parseVTodos(ics: string): VTodo[] {
  return blocksOf(ics, "VTODO").flatMap((lines) => mapVTodo(lines) ?? []);
}

/** Maps the unfolded lines between BEGIN:VTODO and END:VTODO. Null when there is no UID. */
export function mapVTodo(lines: string[]): VTodo | null {
  let uid = "";
  let summary = "";
  let description: string | null = null;
  let statusValue: string | null = null;
  let rawPriority: number | null = null;
  let due: Due | null = null;
  const categories: string[] = [];
  let percentComplete: number | null = null;
  let completed: string | null = null;
  const unknownProps: string[] = [];

  let nested = 0;
  for (const line of lines) {
    // Nested components (VALARM) are kept whole, as raw lines.
    if (/^BEGIN:/i.test(line)) {
      nested++;
      unknownProps.push(line);
      continue;
    }
    if (/^END:/i.test(line)) {
      nested = Math.max(0, nested - 1);
      unknownProps.push(line);
      continue;
    }
    if (nested > 0) {
      unknownProps.push(line);
      continue;
    }
    const prop = parseContentLine(line);
    if (!prop) {
      unknownProps.push(line);
      continue;
    }
    switch (prop.name) {
      case "UID":
        uid = prop.value.trim();
        break;
      case "SUMMARY":
        summary = unescapeText(prop.value);
        break;
      case "DESCRIPTION":
        description = unescapeText(prop.value);
        break;
      case "STATUS":
        statusValue = prop.value.trim().toUpperCase();
        break;
      case "PRIORITY": {
        const parsed = Number.parseInt(prop.value.trim(), 10);
        rawPriority = Number.isNaN(parsed) ? null : parsed;
        break;
      }
      case "DUE": {
        const parsed = parseDue(prop);
        if (parsed) due = parsed;
        else unknownProps.push(line); // not understood: keep it for a later edit
        break;
      }
      case "CATEGORIES":
        for (const piece of splitEscaped(prop.value)) {
          const tag = unescapeText(piece).trim();
          if (tag && !categories.includes(tag)) categories.push(tag);
        }
        break;
      case "PERCENT-COMPLETE": {
        const parsed = Number.parseInt(prop.value.trim(), 10);
        percentComplete = Number.isNaN(parsed) ? null : Math.min(100, Math.max(0, parsed));
        break;
      }
      case "COMPLETED":
        completed = prop.value.trim();
        break;
      default:
        unknownProps.push(line);
    }
  }
  if (!uid) return null;

  let status: TaskStatus;
  if (statusValue !== null && (STATUSES as readonly string[]).includes(statusValue)) {
    status = statusValue as TaskStatus;
  } else if (statusValue === null && (completed !== null || percentComplete === 100)) {
    status = "COMPLETED";
  } else {
    status = "NEEDS-ACTION";
  }

  return {
    uid,
    summary,
    description,
    status,
    priority: mapPriority(rawPriority),
    rawPriority,
    due,
    categories,
    someday: categories.some((tag) => tag.toLowerCase() === "someday"),
    percentComplete,
    completed,
    unknownProps,
  };
}

// ---------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------

/** What an edit may change. A key that is missing stays as it is. Nothing here can write DTSTART. */
export type TodoPatch = {
  summary?: string;
  /** null or "" removes the DESCRIPTION. */
  description?: string | null;
  /** YYYY-MM-DD, or null to remove the DUE. The same date as the file already has leaves the line alone. */
  due?: string | null;
  /** null removes PRIORITY. The same app priority as the file already has leaves the line alone. */
  priority?: Priority | null;
  /** The whole tag list. The same list as the file already has leaves the CATEGORIES lines alone. */
  categories?: string[];
  /** Adds (true) or removes (false) the "someday" tag on top of `categories`, or of the tags the file already has. */
  someday?: boolean;
  /** STATUS:COMPLETED, COMPLETED:<now>, PERCENT-COMPLETE:100. */
  complete?: boolean;
  /** Back to STATUS:NEEDS-ACTION when the task is not open: COMPLETED and PERCENT-COMPLETE are removed. */
  reopen?: boolean;
  /** STATUS:CANCELLED. COMPLETED and PERCENT-COMPLETE are removed, so a cancelled task never reads as finished. */
  cancel?: boolean;
};

export type NewTodo = {
  uid: string;
  summary: string;
  description?: string | null;
  due?: string | null;
  priority?: Priority | null;
  categories?: string[];
  /** Write the task as finished: STATUS:COMPLETED, COMPLETED:<now>, PERCENT-COMPLETE:100. */
  complete?: boolean;
  /** Write the task as dropped: STATUS:CANCELLED. Ignored when `complete` is set. */
  cancel?: boolean;
};

/** `YYYYMMDDTHHMMSSZ` for an epoch ms. */
export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** TEXT escaping: backslash, semicolon, comma, and line breaks as \n. */
export function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** Folds one logical line at 75 octets. Never splits a UTF-8 character. Continuation lines start with one space. */
export function foldLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char, "utf8");
    if (bytes + size > 75) {
      out.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out;
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

function dateValue(date: string): string {
  if (!isIsoDate(date)) throw new TypeError("due must be a date as YYYY-MM-DD");
  return date.replace(/-/g, "");
}

export const summaryLine = (summary: string) => `SUMMARY:${escapeText(summary)}`;
const descriptionLine = (description: string) => `DESCRIPTION:${escapeText(description)}`;
const dueLine = (date: string) => `DUE;VALUE=DATE:${dateValue(date)}`;
const priorityLine = (priority: Priority) => `PRIORITY:${priority}`;
export const categoriesLine = (categories: string[]) => `CATEGORIES:${categories.map(escapeText).join(",")}`;

/** A whole VCALENDAR with one new VTODO: CRLF line ends, lines folded at 75 octets, no DTSTART. */
export function buildNewTodo(input: NewTodo, nowMs: number): string {
  const stamp = formatUtc(nowMs);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//bujo//bujo//EN",
    "BEGIN:VTODO",
    `UID:${input.uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    summaryLine(input.summary),
  ];
  if (input.description) lines.push(descriptionLine(input.description));
  if (input.complete) lines.push("STATUS:COMPLETED", `COMPLETED:${stamp}`, "PERCENT-COMPLETE:100");
  else lines.push(input.cancel ? "STATUS:CANCELLED" : "STATUS:NEEDS-ACTION");
  if (input.priority) lines.push(priorityLine(input.priority));
  if (input.due) lines.push(dueLine(input.due));
  if (input.categories && input.categories.length > 0) lines.push(categoriesLine(input.categories));
  lines.push("END:VTODO", "END:VCALENDAR");
  return lines.flatMap(foldLine).join("\r\n") + "\r\n";
}

/** One logical line: its unfolded text, and its physical lines exactly as the file had them. */
type Logical = { text: string; raw: string[] };

function splitLogical(ics: string): Logical[] {
  const out: Logical[] = [];
  const physical = ics.split(/\r\n|\n|\r/);
  if (physical.length > 0 && physical[physical.length - 1] === "") physical.pop();
  for (const line of physical) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) {
      const last = out[out.length - 1];
      last.text += line.slice(1);
      last.raw.push(line);
    } else {
      out.push({ text: line, raw: [line] });
    }
  }
  return out;
}

/** A top-level property, or a whole nested component (VALARM and so on) kept as one block. */
type Item = { kind: "prop"; name: string; line: Logical } | { kind: "component"; lines: Logical[] };

export class TodoNotFoundError extends Error {
  constructor() {
    super("VTODO not found in the calendar object");
    this.name = "TodoNotFoundError";
  }
}

/** Index range of the component (VTODO, VEVENT) with this UID: `begin` is its BEGIN line, `end` its END line. */
function findBlock(all: Logical[], component: string, uid: string): { begin: number; end: number } | null {
  for (let i = 0; i < all.length; i++) {
    if (all[i].text.toUpperCase() !== `BEGIN:${component}`) continue;
    let depth = 0;
    let blockUid = "";
    for (let j = i + 1; j < all.length; j++) {
      const upper = all[j].text.toUpperCase();
      if (upper.startsWith("BEGIN:")) depth++;
      else if (upper === `END:${component}` && depth === 0) {
        if (blockUid === uid) return { begin: i, end: j };
        break;
      } else if (upper.startsWith("END:") && depth > 0) depth--;
      else if (depth === 0) {
        const prop = parseContentLine(all[j].text);
        if (prop?.name === "UID") blockUid = prop.value.trim();
      }
    }
  }
  return null;
}

/** A calendar component opened for surgical edits: the unfolded lines to read, and setProp to change one property. */
export type OpenBlock = {
  /** The unfolded lines between BEGIN and END, as they are now. */
  lines: string[];
  /** Replaces the first line of this property and drops its other lines, or adds it. A null text removes it. */
  setProp(name: string, text: string | null): void;
  /** Bumps LAST-MODIFIED, DTSTAMP and SEQUENCE and returns the whole text, untouched lines as they were. */
  finish(nowMs: number): string;
};

/** The items of a component body: plain properties, and nested components kept whole. */
function itemsOf(inner: Logical[]): Item[] {
  const items: Item[] = [];
  for (let i = 0; i < inner.length; i++) {
    if (/^BEGIN:/i.test(inner[i].text)) {
      const lines = [inner[i]];
      let depth = 1;
      while (depth > 0 && ++i < inner.length) {
        lines.push(inner[i]);
        if (/^BEGIN:/i.test(inner[i].text)) depth++;
        else if (/^END:/i.test(inner[i].text)) depth--;
      }
      items.push({ kind: "component", lines });
    } else {
      items.push({ kind: "prop", name: parseContentLine(inner[i].text)?.name ?? "", line: inner[i] });
    }
  }
  return items;
}

/**
 * Opens the component (VTODO, VEVENT) with this UID for edits that keep everything else as it was: untouched
 * lines come back with their original folding, unknown properties and nested components stay where they are.
 * Null when the object has no such component.
 */
export function openBlock(ics: string, component: string, uid: string): OpenBlock | null {
  const eol = /\r\n|\n|\r/.exec(ics)?.[0] ?? "\r\n";
  const all = splitLogical(ics);
  const range = findBlock(all, component, uid);
  if (!range) return null;
  const { begin, end } = range;
  const inner = all.slice(begin + 1, end);
  const items = itemsOf(inner);

  /** New properties go before the first nested component, as RFC 5545 has it. */
  function insertIndex(): number {
    const firstComponent = items.findIndex((item) => item.kind === "component");
    return firstComponent < 0 ? items.length : firstComponent;
  }

  function setProp(name: string, text: string | null): void {
    const indexes = items.flatMap((item, index) => (item.kind === "prop" && item.name === name ? [index] : []));
    if (text === null) {
      for (const index of indexes.reverse()) items.splice(index, 1);
      return;
    }
    const fresh: Item = { kind: "prop", name, line: { text, raw: foldLine(text) } };
    if (indexes.length === 0) {
      items.splice(insertIndex(), 0, fresh);
      return;
    }
    items[indexes[0]] = fresh;
    for (const index of indexes.slice(1).reverse()) items.splice(index, 1);
  }

  function finish(nowMs: number): string {
    const stamp = formatUtc(nowMs);
    const sequence = items.find((item) => item.kind === "prop" && item.name === "SEQUENCE");
    const previous = sequence && sequence.kind === "prop" ? Number.parseInt(parseContentLine(sequence.line.text)?.value ?? "", 10) : Number.NaN;
    setProp("LAST-MODIFIED", `LAST-MODIFIED:${stamp}`);
    setProp("DTSTAMP", `DTSTAMP:${stamp}`);
    setProp("SEQUENCE", `SEQUENCE:${Number.isFinite(previous) && previous >= 0 ? previous + 1 : 1}`);
    const body: string[] = [];
    for (const item of items) {
      if (item.kind === "prop") body.push(...item.line.raw);
      else for (const line of item.lines) body.push(...line.raw);
    }
    const lines = [...all.slice(0, begin + 1).flatMap((line) => line.raw), ...body, ...all.slice(end).flatMap((line) => line.raw)];
    return lines.join(eol) + eol;
  }

  return { lines: inner.map((line) => line.text), setProp, finish };
}

/**
 * Edits one VTODO of a calendar object and keeps everything else as it was: untouched lines come back
 * with their original folding, unknown properties and nested components stay where they are, and a DUE
 * line (a TZID one too) is only rewritten when the date changes.
 *
 * Every real change bumps LAST-MODIFIED, DTSTAMP and SEQUENCE. A patch that changes nothing returns
 * `changed: false` and the text as it came in, so the caller can skip the write.
 */
export function editTodo(ics: string, uid: string, patch: TodoPatch, nowMs: number): { ics: string; changed: boolean } {
  const block = openBlock(ics, "VTODO", uid);
  const current = block ? mapVTodo(block.lines) : null;
  if (!block || !current) throw new TodoNotFoundError();
  const setProp = block.setProp;
  let changed = false;

  if (patch.summary !== undefined && patch.summary !== current.summary) {
    setProp("SUMMARY", summaryLine(patch.summary));
    changed = true;
  }
  if (patch.description !== undefined) {
    const next = patch.description === null || patch.description === "" ? null : patch.description;
    if (next !== current.description) {
      setProp("DESCRIPTION", next === null ? null : descriptionLine(next));
      changed = true;
    }
  }
  if (patch.due !== undefined) {
    if (patch.due === null) {
      if (current.due !== null) {
        setProp("DUE", null);
        changed = true;
      }
    } else if (current.due?.date !== patch.due) {
      setProp("DUE", dueLine(patch.due));
      changed = true;
    }
  }
  if (patch.priority !== undefined && patch.priority !== current.priority) {
    setProp("PRIORITY", patch.priority === null ? null : priorityLine(patch.priority));
    changed = true;
  }
  if (patch.categories !== undefined || patch.someday !== undefined) {
    let next = patch.categories ?? current.categories;
    const isSomeday = (tag: string) => tag.toLowerCase() === "someday";
    if (patch.someday === true && !next.some(isSomeday)) next = [...next, "someday"];
    if (patch.someday === false) next = next.filter((tag) => !isSomeday(tag));
    const same = next.length === current.categories.length && next.every((tag, i) => tag === current.categories[i]);
    if (!same) {
      setProp("CATEGORIES", next.length === 0 ? null : categoriesLine(next));
      changed = true;
    }
  }
  if (patch.complete === true && current.status !== "COMPLETED") {
    setProp("STATUS", "STATUS:COMPLETED");
    setProp("COMPLETED", `COMPLETED:${formatUtc(nowMs)}`);
    setProp("PERCENT-COMPLETE", "PERCENT-COMPLETE:100");
    changed = true;
  }
  if (patch.reopen === true && (current.status !== "NEEDS-ACTION" || current.completed !== null)) {
    setProp("STATUS", "STATUS:NEEDS-ACTION");
    setProp("COMPLETED", null);
    setProp("PERCENT-COMPLETE", null);
    changed = true;
  }

  if (patch.cancel === true && (current.status !== "CANCELLED" || current.completed !== null)) {
    setProp("STATUS", "STATUS:CANCELLED");
    setProp("COMPLETED", null);
    setProp("PERCENT-COMPLETE", null);
    changed = true;
  }

  return changed ? { ics: block.finish(nowMs), changed: true } : { ics, changed: false };
}
