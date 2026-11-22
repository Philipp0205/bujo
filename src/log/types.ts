export const ENTRY_TYPES = ["task", "note", "event", "done", "migrated", "scheduled"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/**
 * How far ahead an entry looks. A day entry sits on its day. A month-task or future entry sits on the last day of its
 * month (which is also its DUE) and is listed by that month, not by a day.
 */
export const ENTRY_HORIZONS = ["day", "month-task", "future"] as const;
export type EntryHorizon = (typeof ENTRY_HORIZONS)[number];

export const SYNC_STATES = ["local", "pending", "synced", "error"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/** One line of the rapid log, as the API shows it. The owner and the remote link are never part of it. */
export type Entry = {
  id: string;
  date: string;
  /** "day" for an ordinary entry. For the other two, date is the last day of the month the entry belongs to. */
  horizon: EntryHorizon;
  time: string | null;
  type: EntryType;
  title: string;
  /** The tags in the order they were written, without repeats (compared ignoring case). Empty when there are none. */
  tags: string[];
  /** The markdown of a free note. Null for a short rapid-log line. */
  body: string | null;
  /** True when a scan photo is stored with the note. The bytes are at GET /api/entries/:id/photo, never in the list. */
  hasPhoto: boolean;
  sync: SyncState;
  /** A short reason for the error state, safe to show. Null in every other state. */
  syncError: string | null;
  position: number;
  /** 0, or 1 when the line is nested under the entry above it in the same day. */
  indent: number;
  createdAt: number;
  updatedAt: number;
  /**
   * False when the entry exists in the app but is not written on paper yet: no scan has been applied to it, or the person
   * changed type, title, tags or time since. Derived from the scan provenance, which itself never reaches the API.
   */
  onPaper: boolean;
};

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
