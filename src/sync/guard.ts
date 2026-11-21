import type { CalDavList } from "../caldav/client.ts";
import { EVENT_CALENDAR_NAME, type SyncConfig } from "./config.ts";
import { eventCalendarRefusedMessage, EVENT_CALENDAR_MISSING_MESSAGE, liveListMessage } from "./strings.ts";

/** Names of the real lists, compared without case. */
const LIVE_NAMES = ["aufgaben", "arbeit"];

/** Last path segments that mean a real list: the Nextcloud default task list and the work list. */
const LIVE_SEGMENTS = ["tasks", "aufgaben", "arbeit"];

/** A collection path or URL as a comparable string: path only, decoded, lower case, no trailing slash. */
function normalizePath(path: string): string {
  let pathname: string;
  try {
    pathname = new URL(path, "http://placeholder.invalid").pathname;
  } catch {
    pathname = path;
  }
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // An undecodable path is compared as it is.
  }
  return pathname.toLowerCase().replace(/\/+$/, "");
}

const lastSegment = (normalized: string) => normalized.slice(normalized.lastIndexOf("/") + 1);

/** True when this list is one of the live ones, by name, by a configured live path, or by its last path segment. */
export function isLiveList(target: CalDavList, configured: readonly CalDavList[]): boolean {
  if (LIVE_NAMES.includes(target.name.trim().toLowerCase())) return true;
  const path = normalizePath(target.path);
  if (LIVE_SEGMENTS.includes(lastSegment(path))) return true;
  return configured.some((list) => LIVE_NAMES.includes(list.name.trim().toLowerCase()) && normalizePath(list.path) === path);
}

/**
 * The hard guard. Returns the message to put on the entry when a write to this list must be refused, or
 * null when it may go ahead. It is checked before every push, so nothing reaches the network when it says no.
 */
export function writeRefusal(target: CalDavList, configured: readonly CalDavList[], sync: Pick<SyncConfig, "live">): string | null {
  if (sync.live) return null;
  return isLiveList(target, configured) ? liveListMessage(target.name) : null;
}

/** The path as the server will see it, split on its raw slashes. Null when it hides a slash, a backslash, a query or a hash. */
function rawSegments(path: string): string[] | null {
  if (/[?#\\]|%2f|%5c/i.test(path)) return null;
  let pathname: string;
  try {
    pathname = new URL(path, "http://placeholder.invalid").pathname;
  } catch {
    return null;
  }
  return pathname.split("/").filter((segment) => segment !== "");
}

/** Path segments that mean a real calendar or the task test list. A path holding one is never the event calendar. */
const BLOCKED_EVENT_SEGMENTS = ["personal", "work", "tasks", "aufgaben", "arbeit", "bujo-test"];

/** True when the path's last segment is exactly the allowed calendar, no segment is a live one, and it is not a configured task list. */
function isEventCalendarPath(path: string, configured: readonly CalDavList[]): boolean {
  const segments = rawSegments(path);
  if (!segments || segments.length === 0) return false;
  let decoded: string[];
  try {
    decoded = segments.map((segment) => decodeURIComponent(segment));
  } catch {
    return false;
  }
  if (decoded[decoded.length - 1] !== EVENT_CALENDAR_NAME) return false;
  if (decoded.some((segment) => BLOCKED_EVENT_SEGMENTS.includes(segment.toLowerCase()))) return false;
  const normalized = normalizePath(path);
  return !configured.some((list) => normalizePath(list.path) === normalized);
}

/**
 * The hard guard for VEVENT writes: an allow list of one calendar, "bujo-test-cal". The name and the last
 * segment of the path must both be exactly that. BUJO_LIVE_SYNC does not matter here: no setting opens
 * another calendar for events. Returns the message to put on the entry, or null when the write may go ahead.
 */
export function eventWriteRefusal(target: CalDavList | null | undefined, configured: readonly CalDavList[]): string | null {
  if (!target) return EVENT_CALENDAR_MISSING_MESSAGE;
  if (target.name !== EVENT_CALENDAR_NAME || !isEventCalendarPath(target.path, configured)) {
    return eventCalendarRefusedMessage(EVENT_CALENDAR_NAME);
  }
  return null;
}
