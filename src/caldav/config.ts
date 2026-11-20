import { CalDavClient, type CalDavList } from "./client.ts";

export type CalDavConfig = {
  base: string;
  user: string | undefined;
  password: string | undefined;
  lists: CalDavList[];
};

/**
 * Reads the CalDAV settings from the environment. Returns null when nothing is configured, and the
 * server then uses the built-in demo source.
 *
 *   BUJO_CALDAV_BASE      origin of the server, for example https://cloud.example.com
 *   BUJO_CALDAV_USER      basic auth user (optional for a server without auth, used by tests)
 *   BUJO_CALDAV_PASSWORD  basic auth password or app password
 *   BUJO_CALDAV_LISTS     name=path pairs, separated by commas or newlines:
 *                         Aufgaben=/remote.php/dav/calendars/admin/tasks/,Arbeit=/remote.php/dav/calendars/admin/arbeit/
 *
 * Throws an Error with a plain message when the settings are half there (a base with no lists, a bad pair),
 * so a typo does not silently fall back to the demo data.
 */
export function loadCalDavConfig(env: NodeJS.ProcessEnv = process.env): CalDavConfig | null {
  const base = env.BUJO_CALDAV_BASE?.trim() ?? "";
  const listsRaw = env.BUJO_CALDAV_LISTS?.trim() ?? "";
  if (base === "" && listsRaw === "") return null;
  if (base === "") throw new Error("BUJO_CALDAV_LISTS is set but BUJO_CALDAV_BASE is not");
  if (listsRaw === "") throw new Error("BUJO_CALDAV_BASE is set but BUJO_CALDAV_LISTS is not");
  try {
    new URL(base);
  } catch {
    throw new Error("BUJO_CALDAV_BASE is not a valid URL");
  }
  return {
    base,
    user: env.BUJO_CALDAV_USER || undefined,
    password: env.BUJO_CALDAV_PASSWORD || undefined,
    lists: parseLists(listsRaw),
  };
}

export function parseLists(raw: string): CalDavList[] {
  const lists: CalDavList[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const pair = part.trim();
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const name = eq > 0 ? pair.slice(0, eq).trim() : "";
    const path = eq > 0 ? pair.slice(eq + 1).trim() : "";
    if (name === "" || path === "") throw new Error(`BUJO_CALDAV_LISTS entry "${name || pair}" is not name=path`);
    if (lists.some((list) => list.name === name)) throw new Error(`BUJO_CALDAV_LISTS has "${name}" twice`);
    lists.push({ name, path });
  }
  if (lists.length === 0) throw new Error("BUJO_CALDAV_LISTS has no entries");
  return lists;
}

export function createClient(config: CalDavConfig): CalDavClient {
  return new CalDavClient({ base: config.base, user: config.user, password: config.password });
}
