export const ENTRY_TYPES = ["task", "note", "event", "done", "migrated", "scheduled"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const SYNC_STATES = ["local", "pending", "synced", "error"] as const;
export type SyncState = (typeof SYNC_STATES)[number];

/** One line of the rapid log, as the API shows it. The owner and the remote link are never part of it. */
export type Entry = {
  id: string;
  date: string;
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
};

/** Where an entry lives on the sync target. Kept in the database only, never sent to the browser. */
export type RemoteLink = { href: string; uid: string; etag: string | null };

/** A change of the sync state. `link` is written when given and kept as it is when left out. */
export type SyncChange = { sync: SyncState; error?: string | null; link?: RemoteLink };

/** A checked create request. */
export type NewEntry = {
  date: string;
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
export type EntryPatch = Partial<NewEntry> & {
  /** 0 or 1. A 1 on the first entry of a day stays 0, there is nothing above to nest under. */
  indent?: number;
};

export type DateRange = { from: string; to: string };

/** The outcome of a check. The error is a message safe to show to the caller. */
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
