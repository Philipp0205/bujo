export type SyncConfig = {
  /** Name of the CalDAV list task entries are written to. It must be one of BUJO_CALDAV_LISTS. */
  listName: string;
  /** True only with BUJO_LIVE_SYNC=1. Without it the guard refuses the live lists. */
  live: boolean;
};

/** The list used when BUJO_SYNC_LIST is not set: the test list, never a real one. */
export const DEFAULT_SYNC_LIST = "bujo-test";

/**
 * Reads the sync settings from the environment.
 *
 *   BUJO_SYNC_LIST   name of the target list, resolved through BUJO_CALDAV_LISTS. Default "bujo-test".
 *   BUJO_LIVE_SYNC   "1" allows writes to the live lists (Aufgaben, Arbeit). Anything else keeps the guard on.
 */
export function loadSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  const listName = env.BUJO_SYNC_LIST?.trim() || DEFAULT_SYNC_LIST;
  return { listName, live: env.BUJO_LIVE_SYNC?.trim() === "1" };
}
