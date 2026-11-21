import http from "node:http";
import type { AddressInfo } from "node:net";

// A fake CalDAV server for tests. It listens on 127.0.0.1 only and answers PROPFIND and REPORT with
// multistatus XML built from the fixtures below, GET with one object, and PUT with ETag and precondition
// handling (If-None-Match: * on create, If-Match on update, 412 when it does not hold, 428 with neither).
// It records every request, so a test can check which methods ever arrive: a DELETE is recorded and
// answered with 405, and nothing is removed. The store is a copy per server, so one test's writes never
// reach another. Not a test file: `npm test` only runs `test/**/*.test.ts`.

export const USER = "tester";
export const PASSWORD = "not-a-real-password";

const ics = (...lines: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//bujo//fixture//EN", "BEGIN:VTODO", ...lines, "END:VTODO", "END:VCALENDAR", ""].join("\r\n");

/** Fixture VTODOs with the mixed values of the real lists. All text is invented. */
export const FIXTURES: Record<string, string> = {
  // German text, escaped commas and semicolon, a folded line, priority 1, a date due, tags with an escaped comma.
  "gutachten.ics": ics(
    "UID:fx-gutachten",
    "DTSTAMP:20261101T080000Z",
    "SUMMARY:Gutachten lesen\\, kommentieren\\; abgeben",
    "DESCRIPTION:Erste Zeile\\nZweite Zeile mit einem sehr langen Satz, der in der Dat",
    " ei umgebrochen wurde\\, damit die Zeile nicht zu lang wird.",
    "PRIORITY:1",
    "DUE;VALUE=DATE:20261201",
    "CATEGORIES:Arbeit\\, intern,Gutachten",
    "STATUS:NEEDS-ACTION",
  ),
  // TZID due, priority 5.
  "termin.ics": ics(
    "UID:fx-termin",
    "SUMMARY:Zahnarzt anrufen",
    "PRIORITY:5",
    "DUE;TZID=Europe/Berlin:20261124T093000",
    "STATUS:NEEDS-ACTION",
  ),
  // Priority 9, someday tag.
  "someday.ics": ics("UID:fx-someday", "SUMMARY:Dachboden aufraeumen", "PRIORITY:9", "CATEGORIES:someday,Haushalt", "STATUS:NEEDS-ACTION"),
  // Priority 0 means unset, no STATUS line at all.
  "unset.ics": ics("UID:fx-unset", "SUMMARY:Ohne Prioritaet", "PRIORITY:0"),
  // Completed, with the timestamp and PERCENT-COMPLETE:100.
  "done.ics": ics("UID:fx-done", "SUMMARY:Steuer abgegeben", "STATUS:COMPLETED", "COMPLETED:20261105T101500Z", "PERCENT-COMPLETE:100"),
  // IN-PROCESS with a subtask link and an alarm that must survive as raw lines.
  "process.ics": ics(
    "UID:fx-process",
    "SUMMARY:Umzug planen",
    "PRIORITY:5",
    "STATUS:IN-PROCESS",
    "PERCENT-COMPLETE:40",
    "DTSTART;TZID=Europe/Berlin:20261120T090000",
    "RELATED-TO:fx-done",
    "X-CUSTOM-FLAG;X-PARAM=1:keep me",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "END:VALARM",
  ),
  // CANCELLED.
  "cancelled.ics": ics("UID:fx-cancelled", "SUMMARY:Abgesagter Termin", "STATUS:CANCELLED"),
};

/** A second list, so tests can check list names stay separate. */
export const FIXTURES_ARBEIT: Record<string, string> = {
  "bericht.ics": ics("UID:fx-bericht", "SUMMARY:Bericht schreiben", "PRIORITY:1", "DUE;VALUE=DATE:20261130", "CATEGORIES:Bericht", "STATUS:NEEDS-ACTION"),
};

export const COLLECTIONS: Record<string, Record<string, string>> = {
  "/dav/calendars/test/aufgaben/": FIXTURES,
  "/dav/calendars/test/arbeit/": FIXTURES_ARBEIT,
  // The empty list the sync tests write tasks to. Not in fakeEnv, so the other tests never see it.
  "/dav/calendars/test/bujo-test/": {},
  // The empty VEVENT calendar the event sync writes to. Its own path, never the VTODO list above.
  "/dav/calendars/test/bujo-test-cal/": {},
};

/** The collections that hold VEVENTs. PROPFIND reports VEVENT on these and VTODO on every other one. */
const EVENT_COLLECTIONS = new Set(["/dav/calendars/test/bujo-test-cal/"]);

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Stored = { data: string; etag: string };
type Store = Map<string, Map<string, Stored>>;

function initialStore(): Store {
  const store: Store = new Map();
  for (const [collection, files] of Object.entries(COLLECTIONS)) {
    const map = new Map<string, Stored>();
    Object.entries(files).forEach(([name, data], index) => map.set(name, { data, etag: `"etag-${index}"` }));
    store.set(collection, map);
  }
  return store;
}

function reportBody(collection: string, files: Map<string, Stored>): string {
  const responses = [...files.entries()]
    .map(
      ([name, { data, etag }]) => `  <d:response>
    <d:href>${collection}${name}</d:href>
    <d:propstat>
      <d:prop><d:getetag>${etag}</d:getetag><cal:calendar-data>${xmlEscape(data)}</cal:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">\n${responses}\n</d:multistatus>`;
}

function propfindBody(collection: string): string {
  const component = EVENT_COLLECTIONS.has(collection) ? "VEVENT" : "VTODO";
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${collection}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Fixture list</d:displayname>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set><cal:comp name="${component}"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
}

export type RecordedRequest = {
  method: string;
  url: string;
  depth: string | undefined;
  authorization: string | undefined;
  ifMatch: string | undefined;
  ifNoneMatch: string | undefined;
  body: string;
};

export type FakeCalDav = {
  /** http://127.0.0.1:<port> */
  base: string;
  requests: RecordedRequest[];
  /** Switches a test can flip while the server runs. */
  switches: FakeSwitches;
  /** The stored calendar object text, or undefined. `collection` is a path from LIST_PATHS. */
  read(collection: string, name: string): string | undefined;
  /** Every stored file name of a collection. */
  names(collection: string): string[];
  /** Pretends another client changed the object: a new ETag, same content (or `data` when given). */
  touch(collection: string, name: string, data?: string): void;
  /** Puts an object straight into a collection, as another client would. For seeding a VEVENT that bujo did not write. */
  seed(collection: string, name: string, data: string): void;
  close: () => Promise<void>;
};

/** Behaviour a test can turn on for the sync: a refused write, a wrong read-back, a slow write. */
export type FakeSwitches = {
  /** Answer every PUT with 412 and store nothing. */
  conflictOnPut: boolean;
  /** GET of an object answers a different SUMMARY than the one stored. */
  corruptReadBack: boolean;
  /** Wait this many ms before answering a PUT. */
  putDelayMs: number;
};

export type FakeOptions = {
  /** Answer every request with this status instead (for error tests). */
  failWith?: number;
  /** Basic auth the server wants. Defaults to USER and PASSWORD. */
  auth?: { user: string; password: string };
};

export async function startFakeCalDav(options: FakeOptions = {}): Promise<FakeCalDav> {
  const requests: RecordedRequest[] = [];
  const auth = options.auth ?? { user: USER, password: PASSWORD };
  const expected = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString("base64")}`;
  const store = initialStore();
  const switches: FakeSwitches = { conflictOnPut: false, corruptReadBack: false, putDelayMs: 0 };
  let etagCounter = 0;
  const nextEtag = () => `"etag-v${++etagCounter}"`;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const method = req.method ?? "";
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({
        method,
        url: req.url ?? "",
        depth: req.headers.depth as string | undefined,
        authorization: req.headers.authorization,
        ifMatch: req.headers["if-match"] as string | undefined,
        ifNoneMatch: req.headers["if-none-match"] as string | undefined,
        body,
      });
      if (options.failWith !== undefined) {
        res.writeHead(options.failWith).end();
        return;
      }
      if (req.headers.authorization !== expected) {
        res.writeHead(401, { "www-authenticate": 'Basic realm="fake"' }).end();
        return;
      }
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

      // A collection: PROPFIND and REPORT.
      const files = store.get(pathname);
      if (files) {
        if (method !== "PROPFIND" && method !== "REPORT") {
          res.writeHead(405, { allow: "PROPFIND, REPORT" }).end();
          return;
        }
        const xml = method === "PROPFIND" ? propfindBody(pathname) : reportBody(pathname, files);
        res.writeHead(207, { "content-type": "application/xml; charset=utf-8", "content-length": Buffer.byteLength(xml) });
        res.end(xml);
        return;
      }

      // An object: GET and PUT. Anything else (DELETE included) is refused and nothing is removed.
      const slash = pathname.lastIndexOf("/") + 1;
      const collection = pathname.slice(0, slash);
      const name = decodeURIComponent(pathname.slice(slash));
      const folder = store.get(collection);
      if (!folder || !name.endsWith(".ics")) {
        res.writeHead(404).end();
        return;
      }
      const existing = folder.get(name);
      if (method === "GET") {
        if (!existing) {
          res.writeHead(404).end();
          return;
        }
        const data = switches.corruptReadBack ? existing.data.replace(/^SUMMARY:.*$/m, "SUMMARY:Corrupted") : existing.data;
        res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", etag: existing.etag, "content-length": Buffer.byteLength(data) });
        res.end(data);
        return;
      }
      if (method === "PUT") {
        setTimeout(() => answerPut(), switches.putDelayMs);
        return;
      }
      res.writeHead(405, { allow: "GET, PUT" }).end();

      function answerPut(): void {
        if (switches.conflictOnPut) {
          res.writeHead(412).end();
          return;
        }
        const ifMatch = req.headers["if-match"];
        const ifNoneMatch = req.headers["if-none-match"];
        if (ifMatch === undefined && ifNoneMatch === undefined) {
          res.writeHead(428).end();
          return;
        }
        if (ifNoneMatch === "*" && existing) {
          res.writeHead(412).end();
          return;
        }
        if (ifMatch !== undefined && (!existing || existing.etag !== ifMatch)) {
          res.writeHead(412).end();
          return;
        }
        const etag = nextEtag();
        folder!.set(name, { data: body, etag });
        res.writeHead(existing ? 204 : 201, { etag }).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    switches,
    read: (collection, name) => store.get(collection)?.get(name)?.data,
    names: (collection) => [...(store.get(collection)?.keys() ?? [])],
    touch(collection, name, data) {
      const entry = store.get(collection)?.get(name);
      if (!entry) throw new Error(`no such file ${name}`);
      store.get(collection)!.set(name, { data: data ?? entry.data, etag: nextEtag() });
    },
    seed(collection, name, data) {
      const folder = store.get(collection);
      if (!folder) throw new Error(`no such collection ${collection}`);
      folder.set(name, { data, etag: nextEtag() });
    },
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const LIST_PATHS = {
  Aufgaben: "/dav/calendars/test/aufgaben/",
  Arbeit: "/dav/calendars/test/arbeit/",
  "bujo-test": "/dav/calendars/test/bujo-test/",
  "bujo-test-cal": "/dav/calendars/test/bujo-test-cal/",
} as const;

/** The one event calendar the sync may write to, as the service gets it from BUJO_CALDAV_EVENT_CALENDAR. */
export const EVENT_CALENDAR = { name: "bujo-test-cal", path: LIST_PATHS["bujo-test-cal"] } as const;

/** Sync settings for the service in tests: task list bujo-test, the guard on, the event calendar bujo-test-cal. */
export const SYNC_SETTINGS = { listName: "bujo-test", live: false, eventCalendar: EVENT_CALENDAR } as const;

/** Env for loadCalDavConfig that points at a fake server. */
export function fakeEnv(fake: FakeCalDav): NodeJS.ProcessEnv {
  return {
    BUJO_CALDAV_BASE: fake.base,
    BUJO_CALDAV_USER: USER,
    BUJO_CALDAV_PASSWORD: PASSWORD,
    BUJO_CALDAV_LISTS: `Aufgaben=${LIST_PATHS.Aufgaben},Arbeit=${LIST_PATHS.Arbeit}`,
  };
}

/** Like fakeEnv, plus the empty bujo-test list that the sync writes to and the one event calendar. */
export function syncEnv(fake: FakeCalDav): NodeJS.ProcessEnv {
  const env = fakeEnv(fake);
  return {
    ...env,
    BUJO_CALDAV_LISTS: `${env.BUJO_CALDAV_LISTS},bujo-test=${LIST_PATHS["bujo-test"]}`,
    BUJO_CALDAV_EVENT_CALENDAR: `${EVENT_CALENDAR.name}=${EVENT_CALENDAR.path}`,
  };
}
