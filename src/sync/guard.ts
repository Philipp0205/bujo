import type { CalDavList } from "../caldav/client.ts";
import type { SyncConfig } from "./config.ts";
import { liveListMessage } from "./strings.ts";

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
