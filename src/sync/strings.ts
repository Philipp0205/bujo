// Every message the sync can put on an entry. They are shown in the entry sheet, so they are short,
// plain, and never hold a URL, a path or a credential.

export const SYNC_MESSAGES = {
  conflict: "Nextcloud changed this task at the same moment. Nothing was overwritten. Retry sync to try again.",
  readBackMismatch: "Nextcloud did not keep what was sent (title, status, due date or priority differ).",
  gone: "This task is no longer in Nextcloud. It was not created again.",
  unreachable: "Nextcloud did not answer.",
  refused: "Nextcloud refused the sign-in. Check the CalDAV user and password.",
  unexpected: "The sync failed unexpectedly.",
  interrupted: "The sync was interrupted. Retry sync.",
  retryNotNeeded: "Only an entry with a failed sync can be retried.",
  notSetUp: "Sync to Nextcloud is not set up.",
  eventStays: "An event stays in the calendar, so it cannot be moved into a collection.",
  cancelFailed: "Could not cancel the task in Nextcloud, so it was not moved. It is marked dropped. Retry sync, then move it again.",
} as const;

/** The messages that name the thing being synced: a task (VTODO) or an event (VEVENT). */
export type MessageKind = "todo" | "event";

const EVENT_MESSAGES = {
  conflict: "Nextcloud changed this event at the same moment. Nothing was overwritten. Retry sync to try again.",
  readBackMismatch: "Nextcloud did not keep what was sent (title, time, tags or id differ).",
  gone: "This event is no longer in Nextcloud. It was not created again.",
} as const;

/** The same set of messages for tasks or for events. */
export function messagesFor(kind: MessageKind): Record<keyof typeof SYNC_MESSAGES, string> {
  return kind === "event" ? { ...SYNC_MESSAGES, ...EVENT_MESSAGES } : SYNC_MESSAGES;
}

/** The calendar object found for an event has no matching X-BUJO-ID, so it is not ours and is left alone. */
export const NOT_OURS_MESSAGE = "This event in Nextcloud was not made by bujo. Nothing was changed.";

/** The sync list named for tasks is not one of the configured lists. */
export const unknownListMessage = (name: string) => `The sync list "${name}" is not set up.`;

/** The hard guard refused a write to a live list. */
export const liveListMessage = (name: string) =>
  `Writes to the live list "${name}" are switched off. Nothing was written.`;

/** BUJO_CALDAV_EVENT_CALENDAR is missing, or is not a name=path pair. */
export const EVENT_CALENDAR_MISSING_MESSAGE = "The event calendar is not set up.";

/** The event guard refused a calendar. It names the one allowed calendar, never the refused path. */
export const eventCalendarRefusedMessage = (allowed: string) =>
  `Events are only written to the test calendar "${allowed}". Nothing was written.`;

/** Nextcloud answered with a status the sync does not handle. */
export const statusMessage = (status: number) => `Nextcloud answered ${status}.`;

/** The reasons a read-back can differ, for the server log (never shown). */
export const mismatchReason = (field: string) => `read-back differs in ${field}`;

// What the server prints at startup about events. Only the calendar name, never a path, URL or credential.
export const eventsLog = {
  calendar: (name: string) => `calendar "${name}"`,
  refused: (name: string, allowed: string) => `calendar "${name}" (refused, only "${allowed}" is written)`,
  off: "off (events stay local, nothing is sent)",
  unusable: "off (BUJO_CALDAV_EVENT_CALENDAR is not name=path, events stay local, nothing is sent)",
  noCaldav: "off (events stay local)",
} as const;
