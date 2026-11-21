import type { CalDavConfig } from "../caldav/config.ts";
import type { SyncConfig } from "./config.ts";
import { EVENT_CALENDAR_NAME } from "./config.ts";
import { eventWriteRefusal } from "./guard.ts";
import { eventsLog } from "./strings.ts";

/** The text after "events" in the startup log. It holds the calendar name only, never a path, URL or credential. */
export function eventsStartupText(caldav: CalDavConfig | null, sync: SyncConfig): string {
  if (!caldav) return eventsLog.noCaldav;
  const calendar = sync.eventCalendar;
  if (!calendar) return eventsLog.off;
  if (eventWriteRefusal(calendar, caldav.lists) !== null) return eventsLog.refused(calendar.name, EVENT_CALENDAR_NAME);
  return eventsLog.calendar(calendar.name);
}
