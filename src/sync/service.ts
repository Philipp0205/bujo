import { randomUUID } from "node:crypto";
import { createClient, type CalDavConfig } from "../caldav/config.ts";
import type { CalDavClient, CalDavList } from "../caldav/client.ts";
import type { Db } from "../db.ts";
import { createEntryStore, type EntryStore } from "../log/store.ts";
import type { Entry, EntryPatch } from "../log/types.ts";
import type { SyncConfig } from "./config.ts";
import { eventWriteRefusal, writeRefusal } from "./guard.ts";
import { syncKind, type SyncKind } from "./mapping.ts";
import { describeFailure, pushEntry, type PushDeps } from "./push.ts";
import { EVENT_CALENDAR_MISSING_MESSAGE, SYNC_MESSAGES, unknownListMessage } from "./strings.ts";

export type SyncServiceOptions = {
  db: Db;
  caldav: CalDavConfig;
  sync: SyncConfig;
  /** For tests. Defaults to a client made from the CalDAV config. */
  client?: CalDavClient;
  now?: () => number;
  uuid?: () => string;
  /** Where the technical detail of a failure goes. Default console.error. It never holds a URL or a credential. */
  log?: (message: string) => void;
};

/** Pushes rapid-log entries to Nextcloud, one way, in the background. */
export type SyncService = {
  /**
   * Starts a push for an entry and returns it at once: pending when a push was queued, error when the guard or
   * the list setup refused it, local for a type that does not sync. The push itself runs after this returns.
   */
  enqueue(userId: string, entry: Entry): Entry;
  /** Resolves when every queued push has finished. For tests and a clean shutdown. */
  idle(): Promise<void>;
};

/**
 * True when an edit changes something the calendar object shows. A task shows title, type, day and (for a month or future
 * entry) the horizon, which decides its DUE. An event also shows its time and tags. `entry` is the entry after the edit.
 */
export function touchesMapping(patch: EntryPatch, entry: Pick<Entry, "type">): boolean {
  if ("title" in patch || "type" in patch || "date" in patch || "horizon" in patch) return true;
  return entry.type === "event" && ("time" in patch || "tags" in patch);
}

type Queue = { tail: Promise<void>; waiting: number };

/** Where a push goes: a list to write to, or the message that says why nothing may be written. */
type Target = { list: CalDavList } | { refusal: string };

/** The task list for a VTODO push, or the reason it cannot be used. Keeps the live-list guard. */
function todoTarget(caldav: CalDavConfig, sync: SyncConfig): Target {
  const list = caldav.lists.find((item) => item.name === sync.listName);
  if (!list) return { refusal: unknownListMessage(sync.listName) };
  const refusal = writeRefusal(list, caldav.lists, sync);
  return refusal ? { refusal } : { list };
}

/** The event calendar for a VEVENT push, or the reason it cannot be used. Only the allow-listed calendar passes. */
function eventTarget(caldav: CalDavConfig, sync: SyncConfig): Target {
  const calendar = sync.eventCalendar;
  const refusal = eventWriteRefusal(calendar, caldav.lists);
  return refusal !== null || !calendar ? { refusal: refusal ?? EVENT_CALENDAR_MISSING_MESSAGE } : { list: calendar };
}

/** The target for a kind of object. */
function targetFor(kind: SyncKind, caldav: CalDavConfig, sync: SyncConfig): Target {
  return kind === "event" ? eventTarget(caldav, sync) : todoTarget(caldav, sync);
}

/**
 * Builds the sync service. Pushes for one entry run one after the other, so two quick edits never both create
 * an object. A job reads the entry again when it runs, so it always pushes the newest text, to the target its
 * current type needs.
 */
export function createSyncService(options: SyncServiceOptions): SyncService {
  const store = createEntryStore(options.db);
  const client = options.client ?? createClient(options.caldav);
  const log = options.log ?? ((message: string) => console.error(message));
  const deps = (list: CalDavList): PushDeps => ({
    client,
    list,
    eventCalendar: options.sync.eventCalendar,
    now: options.now ?? Date.now,
    uuid: options.uuid ?? randomUUID,
  });
  const queues = new Map<string, Queue>();

  /** One push for one entry, with the state written when it ends. `last` is false while another push is queued behind it. */
  async function run(userId: string, id: string, last: () => boolean): Promise<void> {
    const entry = store.get(userId, id);
    if (!entry) return;
    const kind = syncKind(entry.type);
    if (!kind) {
      if (last()) store.setSync(userId, id, { sync: "local" });
      return;
    }
    const target = targetFor(kind, options.caldav, options.sync);
    if ("refusal" in target) {
      if (last()) store.setSync(userId, id, { sync: "error", error: target.refusal });
      return;
    }
    await push(userId, entry, target.list, last);
  }

  /** The push itself, with the state written when it ends. */
  async function push(userId: string, entry: Entry, list: CalDavList, last: () => boolean): Promise<void> {
    try {
      const link = await pushEntry(deps(list), entry, store.getRemote(userId, entry.id));
      store.setSync(userId, entry.id, { sync: last() ? "synced" : "pending", link });
    } catch (error) {
      const failure = describeFailure(error, syncKind(entry.type) ?? "todo");
      log(`sync failed: ${failure.message}`);
      store.setSync(userId, entry.id, { sync: last() ? "error" : "pending", error: failure.shown, link: failure.link });
    }
  }

  /** Adds a job to the queue of its entry. */
  function queue(userId: string, id: string): void {
    const q = queues.get(id) ?? { tail: Promise.resolve(), waiting: 0 };
    q.waiting += 1;
    q.tail = q.tail.then(async () => {
      q.waiting -= 1;
      try {
        await run(userId, id, () => q.waiting === 0);
      } catch (error) {
        log(`sync crashed: ${error instanceof Error ? error.name : "unknown"}`);
        store.setSync(userId, id, { sync: "error", error: SYNC_MESSAGES.unexpected });
      }
      if (q.waiting === 0 && queues.get(id) === q) queues.delete(id);
    });
    queues.set(id, q);
  }

  /** Marks an entry as failed without any network call. */
  function refuse(userId: string, entry: Entry, message: string): Entry {
    return store.setSync(userId, entry.id, { sync: "error", error: message }) ?? entry;
  }

  return {
    enqueue(userId, entry) {
      const kind = syncKind(entry.type);
      if (!kind) return entry.sync === "local" ? entry : (store.setSync(userId, entry.id, { sync: "local" }) ?? entry);
      const target = targetFor(kind, options.caldav, options.sync);
      if ("refusal" in target) return refuse(userId, entry, target.refusal);
      const pending = store.setSync(userId, entry.id, { sync: "pending" }) ?? entry;
      queue(userId, entry.id);
      return pending;
    },

    async idle() {
      while (queues.size > 0) await Promise.all([...queues.values()].map((q) => q.tail));
    },
  };
}

/** Turns every entry that was pending when the process stopped into an error the person can retry. */
export function failInterrupted(db: Db): void {
  const store: EntryStore = createEntryStore(db);
  store.failPending(SYNC_MESSAGES.interrupted);
}
