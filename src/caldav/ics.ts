// ICS (RFC 5545) VTODO parser and mapper to the Task type used by bujo.
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

/** Parses every VTODO in an iCalendar text. A VTODO with no UID is skipped, it cannot be addressed. */
export function parseVTodos(ics: string): VTodo[] {
  const todos: VTodo[] = [];
  let lines: string[] | null = null;
  let depth = 0;
  for (const line of unfold(ics)) {
    const upper = line.toUpperCase();
    if (lines === null) {
      if (upper === "BEGIN:VTODO") {
        lines = [];
        depth = 0;
      }
      continue;
    }
    if (upper.startsWith("BEGIN:")) depth++;
    if (upper === "END:VTODO" && depth === 0) {
      const todo = mapVTodo(lines);
      if (todo) todos.push(todo);
      lines = null;
      continue;
    }
    if (upper.startsWith("END:") && depth > 0) depth--;
    lines.push(line);
  }
  return todos;
}

function mapVTodo(lines: string[]): VTodo | null {
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
