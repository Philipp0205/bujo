export const ENTRY_TYPES = ["task", "note", "event", "done", "migrated", "scheduled", "dropped"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/**
 * How far ahead an entry looks. A day entry sits on its day in the daily log. A month-calendar entry sits on a real day
 * too, but belongs to the monthly calendar page, not the daily log. A month-task or future entry sits on the last day of
 * its month (which is also its DUE) and is listed by that month, not by a day.
 */
export const ENTRY_HORIZONS = ["day", "month-calendar", "month-task", "future"] as const;
export type EntryHorizon = (typeof ENTRY_HORIZONS)[number];

/** What a collection page is: a list, a tracker, a project or anything else. Set on a free note that was scanned as a collection. */
export const NOTE_KINDS = ["list", "tracker", "project", "misc"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

/** The section of a month's task page: the work part or the private part. Set on month-task entries read from a scan. */
export const ENTRY_SECTIONS = ["work", "private"] as const;
export type EntrySection = (typeof ENTRY_SECTIONS)[number];

export const SYNC_STATES = ["local", "pending", "synced", "error"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/** One line of the rapid log, as the API shows it. The owner and the remote link are never part of it. */
export type Entry = {
  id: string;
  date: string;
  /** "day" for a daily-log entry, "month-calendar" for one on the monthly calendar (both dated by a real day). For month-task and future, date is the last day of the month the entry belongs to. */
  horizon: EntryHorizon;
  time: string | null;
  type: EntryType;
  title: string;
  /** The tags in the order they were written, without repeats (compared ignoring case). Empty when there are none. */
  tags: string[];
  /** The markdown of a free note. Null for a short rapid-log line. */
  body: string | null;
  /** The collection kind of a free note (list, tracker, project, misc), or null for a plain note or a log line. The API always sends it; a built entry may leave it out. */
  noteKind?: NoteKind | null;
  /** The section (work or private) of a month-task entry, or null when it has none. The API always sends it; a built entry may leave it out. */
  section?: EntrySection | null;
  /** The custom collection (a named page) the entry is filed on, or null when it sits on the daily log. A collection entry is not on any day page. */
  collectionId: string | null;
  /** The handwritten * before the bullet. Maps to PRIORITY:1 on the sync target. */
  important: boolean;
  /** True when a scan photo is stored with the note. The bytes are at GET /api/entries/:id/photo, never in the list. */
  hasPhoto: boolean;
  sync: SyncState;
  /** A short reason for the error state, safe to show. Null in every other state. */
  syncError: string | null;
  position: number;
  /** The physical page of its day the entry was read from (1, 2, ...), or null when it is not on paper (written in the app). Null sorts after every page. */
  page: number | null;
  /** 0, or 1 when the line is nested under the entry above it in the same day. */
  indent: number;
  createdAt: number;
  updatedAt: number;
  /**
   * False when the entry exists in the app but is not written on paper yet: no scan has been applied to it, or the person
   * changed type, title, tags or time since. Derived from the scan provenance, which itself never reaches the API.
   */
  onPaper: boolean;
  /** "scan" when the title came from a paper scan and is unchanged since, else "app" (see origin.ts). Absent on a queued entry that was never saved: that reads as "app". */
  origin?: EntryOrigin;
};

/** Where an entry's text came from. */
export type EntryOrigin = "scan" | "app";

/** Where an entry lives on the sync target. Kept in the database only, never sent to the browser. */
export type RemoteLink = { href: string; uid: string; etag: string | null };

/** A change of the sync state. `link` is written when given and kept as it is when left out. */
export type SyncChange = { sync: SyncState; error?: string | null; link?: RemoteLink };

/** A checked create request. */
export type NewEntry = {
  /** A client-made UUID (a device that was offline). The server mints one when it is left out. */
  id?: string;
  date: string;
  /** Left out means "day". */
  horizon?: EntryHorizon;
  type: EntryType;
  title: string;
  tags: string[];
  time: string | null;
  body?: string | null;
  /** The collection kind of a free note. Left out or null means a plain note. */
  noteKind?: NoteKind | null;
  /** The section (work or private) of a month-task entry. Left out or null means none. */
  section?: EntrySection | null;
  /** The collection to file the entry on. Left out or null means the daily log. A collection entry always has the "day" horizon. */
  collectionId?: string | null;
  /** Left out means not important. */
  important?: boolean;
};

/**
 * The paper line last applied to an entry by a scan: what the next scan compares against.
 * `key` is the matchKey of the title. `at` is when it was written. Database only, never in the Entry API.
 */
export type ScanSnapshot = {
  key: string;
  type: EntryType;
  title: string;
  tags: string[];
  time: string | null;
  at: number;
};

/** A custom collection: a named page of entries (like "books to read"). `count` is how many entries are filed on it. */
export type Collection = { id: string; name: string; count: number; createdAt: number; paperPage: number | null };

/** One tag in use, for the autocomplete: how many entries carry it and when one of them last changed. */
export type TagUse = { tag: string; count: number; lastUsed: number };

/** An entry with its scan provenance, for the scan routes only. `scan` is null for an entry no scan has touched. */
export type ScanEntry = Entry & { scan?: ScanSnapshot | null };

export type MoveDirection = "up" | "down";

/** A checked edit. Only the keys present are changed. An empty tags list, a null time or a null body clears it. */
export type EntryPatch = Partial<Omit<NewEntry, "id">> & {
  /** 0 or 1. A 1 on the first entry of a day stays 0, there is nothing above to nest under. */
  indent?: number;
};

/** Why an entry left a page: moved on (migrated, ">") or scheduled ahead ("<"). */
export const TRACE_KINDS = ["migrated", "scheduled"] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

/**
 * What a move leaves on the page the entry came from: a muted ">" or "<" line with the title as it was. Local only: it has no
 * UID, is never an entry, and never reaches the sync target. The live entry keeps its id and moves on.
 */
export type Trace = {
  id: string;
  entryId: string;
  /** The old page: a day, or the last day of the old month with its horizon. */
  date: string;
  horizon: EntryHorizon;
  kind: TraceKind;
  title: string;
  createdAt: number;
};

/** A checked edit that may also ask for a trace on the old page. The trace is only left when the edit moves the entry to another page. */
export type EntryChange = EntryPatch & { trace?: TraceKind };

export type DateRange = { from: string; to: string };

/** The outcome of a check. The error is a message safe to show to the caller. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
