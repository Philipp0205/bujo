import { randomUUID } from "node:crypto";
import { createClient, type CalDavConfig } from "../caldav/config.ts";
import type { CalDavClient, CalDavList } from "../caldav/client.ts";
import type { Db } from "../db.ts";
import { createEntryStore, type EntryStore } from "../log/store.ts";
import type { Entry, EntryPatch } from "../log/types.ts";
import type { SyncConfig } from "./config.ts";
import { writeRefusal } from "./guard.ts";
import { isSyncable } from "./mapping.ts";
import { describeFailure, pushEntry, type PushDeps } from "./push.ts";
import { SYNC_MESSAGES, unknownListMessage } from "./strings.ts";

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

/** True when an edit changes something the VTODO shows (title, type, day). A tag or time edit does not. */
export function touchesMapping(patch: EntryPatch): boolean {
  return "title" in patch || "type" in patch || "date" in patch;
}

type Queue = { tail: Promise<void>; waiting: number };

/** The one entry of the CalDAV config the sync writes to, or null when it is not there. */
function targetList(caldav: CalDavConfig, sync: SyncConfig): CalDavList | null {
  return caldav.lists.find((list) => list.name === sync.listName) ?? null;
}

/**
 * Builds the sync service. Pushes for one entry run one after the other, so two quick edits never both create
 * a VTODO. A job reads the entry again when it runs, so it always pushes the newest text.
 */
export function createSyncService(options: SyncServiceOptions): SyncService {
  const store = createEntryStore(options.db);
  const client = options.client ?? createClient(options.caldav);
  const log = options.log ?? ((message: string) => console.error(message));
  const deps = (list: CalDavList): PushDeps => ({
    client,
    list,
    now: options.now ?? Date.now,
    uuid: options.uuid ?? randomUUID,
  });
  const queues = new Map<string, Queue>();

  /** One push for one entry, with the state written when it ends. `last` is false while another push is queued behind it. */
  async function run(userId: string, id: string, list: CalDavList, last: () => boolean): Promise<void> {
    const entry = store.get(userId, id);
    if (!entry) return;
    if (!isSyncable(entry.type)) {
      if (last()) store.setSync(userId, id, { sync: "local" });
      return;
    }
    try {
      const link = await pushEntry(deps(list), entry, store.getRemote(userId, id));
      store.setSync(userId, id, { sync: last() ? "synced" : "pending", link });
    } catch (error) {
      const failure = describeFailure(error);
      log(`sync failed: ${failure.message}`);
      store.setSync(userId, id, { sync: last() ? "error" : "pending", error: failure.shown, link: failure.link });
    }
  }

  /** Adds a job to the queue of its entry. */
  function queue(userId: string, id: string, list: CalDavList): void {
    const q = queues.get(id) ?? { tail: Promise.resolve(), waiting: 0 };
    q.waiting += 1;
    q.tail = q.tail.then(async () => {
      q.waiting -= 1;
      try {
        await run(userId, id, list, () => q.waiting === 0);
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
      if (!isSyncable(entry.type)) {
        return entry.sync === "local" ? entry : (store.setSync(userId, entry.id, { sync: "local" }) ?? entry);
      }
      const list = targetList(options.caldav, options.sync);
      if (!list) return refuse(userId, entry, unknownListMessage(options.sync.listName));
      const refused = writeRefusal(list, options.caldav.lists, options.sync);
      if (refused) return refuse(userId, entry, refused);
      const pending = store.setSync(userId, entry.id, { sync: "pending" }) ?? entry;
      queue(userId, entry.id, list);
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
