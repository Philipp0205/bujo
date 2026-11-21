import type { CalDavList } from "../caldav/client.ts";

export type SyncConfig = {
  /** Name of the CalDAV list task entries are written to. It must be one of BUJO_CALDAV_LISTS. */
  listName: string;
  /** True only with BUJO_LIVE_SYNC=1. Without it the guard refuses the live task lists. It never opens a calendar for events. */
  live: boolean;
  /** The one calendar event entries are written to, or null/absent when BUJO_CALDAV_EVENT_CALENDAR is missing or unusable. */
  eventCalendar?: CalDavList | null;
};

/** The list used when BUJO_SYNC_LIST is not set: the test list, never a real one. */
export const DEFAULT_SYNC_LIST = "bujo-test";

/** The only calendar a VEVENT may be written to. It is the default name and the whole allow list. */
export const EVENT_CALENDAR_NAME = "bujo-test-cal";

/** A `name=path` pair like one BUJO_CALDAV_LISTS entry. Null for an empty value or one that is not name=path. */
export function parseEventCalendar(raw: string | undefined): CalDavList | null {
  const pair = raw?.trim() ?? "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const path = pair.slice(eq + 1).trim();
  return name === "" || path === "" ? null : { name, path };
}

/**
 * Reads the sync settings from the environment.
 *
 *   BUJO_SYNC_LIST              name of the target task list, resolved through BUJO_CALDAV_LISTS. Default "bujo-test".
 *   BUJO_LIVE_SYNC              "1" allows writes to the live task lists (Aufgaben, Arbeit). Anything else keeps the guard on.
 *   BUJO_CALDAV_EVENT_CALENDAR  name=path of the event calendar. Only "bujo-test-cal" is ever written, see guard.ts.
 */
export function loadSyncConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  const listName = env.BUJO_SYNC_LIST?.trim() || DEFAULT_SYNC_LIST;
  return { listName, live: env.BUJO_LIVE_SYNC?.trim() === "1", eventCalendar: parseEventCalendar(env.BUJO_CALDAV_EVENT_CALENDAR) };
}
