// Read-only CalDAV client for VTODO collections, over fetch.
//
// It can only send PROPFIND and REPORT. There is no PUT, DELETE or PROPPATCH code path in this module,
// and `request` accepts nothing else, so a bug elsewhere cannot write to a list.
//
// Credentials come from the caller (config.ts reads them from the environment). Nothing is stored here.
// Redirects are not followed, so the Authorization header never goes to another host.

import { parseVTodos, type Task } from "./ics.ts";

export type CalDavReadMethod = "PROPFIND" | "REPORT";

export type CalDavList = {
  /** Display name in the app, for example Aufgaben or Arbeit. */
  name: string;
  /** Path (or absolute URL) of the collection, relative to the base URL. */
  path: string;
};

export type CalDavOptions = {
  /** Origin of the server, for example https://cloud.example.com. List paths are resolved against it. */
  base: string;
  user?: string;
  password?: string;
  /** Per request timeout. Default 15000. */
  timeoutMs?: number;
  /** For tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
};

export class CalDavError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "CalDavError";
    this.status = status;
  }
}

/** One calendar resource from a REPORT answer. */
export type CalendarObject = { href: string; etag: string | null; data: string };

const NS = '<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">';

/** Asks for every VTODO of a collection. No time range, no status filter: the app filters. */
export const CALENDAR_QUERY_VTODO = `<?xml version="1.0" encoding="utf-8"?>
${NS}
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>
</c:calendar-query>`;

export const PROPFIND_COLLECTION = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/></d:prop>
</d:propfind>`;

export type CollectionInfo = {
  displayName: string | null;
  isCalendar: boolean;
  /** Component names from supported-calendar-component-set (VTODO, VEVENT). Empty when the server does not say. */
  components: string[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlText(text: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  if (cdata) return cdata[1];
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity];
  });
}

/** Text of the first element with this local name (any namespace prefix), or null. */
function elementText(xml: string, local: string): string | null {
  const match = new RegExp(`<(?:[\\w.-]+:)?${local}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}\\s*>`).exec(xml);
  return match ? decodeXmlText(match[1]) : null;
}

/** Splits a 207 multistatus body into its response blocks, and keeps only those with a 2xx propstat. */
export function parseMultistatus(xml: string): CalendarObject[] {
  const objects: CalendarObject[] = [];
  const responses = xml.match(/<(?:[\w.-]+:)?response(?:\s[^>]*)?>[\s\S]*?<\/(?:[\w.-]+:)?response\s*>/g) ?? [];
  for (const block of responses) {
    const href = elementText(block, "href");
    const data = elementText(block, "calendar-data");
    if (href === null || data === null || data.trim() === "") continue;
    const etag = elementText(block, "getetag");
    objects.push({ href: href.trim(), etag: etag === null ? null : etag.trim(), data });
  }
  return objects;
}

export function parseCollectionInfo(xml: string): CollectionInfo {
  const resourcetype = elementText(xml, "resourcetype") ?? "";
  const components: string[] = [];
  for (const match of xml.matchAll(/<(?:[\w.-]+:)?comp\s[^>]*name="([^"]+)"/g)) components.push(match[1].toUpperCase());
  const displayName = elementText(xml, "displayname");
  return {
    displayName: displayName === null || displayName.trim() === "" ? null : displayName.trim(),
    isCalendar: /<(?:[\w.-]+:)?calendar[\s/>]/.test(resourcetype),
    components,
  };
}

export class CalDavClient {
  private readonly base: URL;
  private readonly authorization: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CalDavOptions) {
    this.base = new URL(options.base);
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetch ?? fetch;
    this.authorization =
      options.user !== undefined && options.user !== ""
        ? `Basic ${Buffer.from(`${options.user}:${options.password ?? ""}`, "utf8").toString("base64")}`
        : null;
  }

  /** Resolves a list path against the base URL. The result must stay on the same origin as the base. */
  collectionUrl(path: string): URL {
    const url = new URL(path, this.base);
    if (url.origin !== this.base.origin) throw new CalDavError("list path leaves the CalDAV server origin");
    return url;
  }

  private async request(method: CalDavReadMethod, url: URL, body: string, depth: "0" | "1"): Promise<string> {
    const headers: Record<string, string> = {
      "content-type": "application/xml; charset=utf-8",
      depth,
      accept: "application/xml, text/xml",
    };
    if (this.authorization) headers.authorization = this.authorization;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "timed out" : "unreachable";
      throw new CalDavError(`CalDAV ${method} ${reason}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError(`CalDAV ${method} refused (${response.status}), check user and password`, response.status);
    }
    if (response.status !== 207) {
      throw new CalDavError(`CalDAV ${method} answered ${response.status}`, response.status);
    }
    return await response.text();
  }

  /** PROPFIND depth 0: what is this collection, and does it hold VTODOs? */
  async describeCollection(path: string): Promise<CollectionInfo> {
    const xml = await this.request("PROPFIND", this.collectionUrl(path), PROPFIND_COLLECTION, "0");
    return parseCollectionInfo(xml);
  }

  /** REPORT calendar-query for VTODO: the raw calendar objects of a collection. */
  async queryTodos(path: string): Promise<CalendarObject[]> {
    const url = this.collectionUrl(path);
    const xml = await this.request("REPORT", url, CALENDAR_QUERY_VTODO, "1");
    return parseMultistatus(xml).map((object) => ({ ...object, href: new URL(object.href, url).href }));
  }

  /** All tasks of one list, mapped to Task. */
  async listTasks(list: CalDavList): Promise<Task[]> {
    const tasks: Task[] = [];
    for (const object of await this.queryTodos(list.path)) {
      for (const todo of parseVTodos(object.data)) {
        tasks.push({ ...todo, list: list.name, href: object.href, etag: object.etag });
      }
    }
    return tasks;
  }
}
