import http from "node:http";
import type { AddressInfo } from "node:net";

// A fake CalDAV server for tests. It listens on 127.0.0.1 only and answers PROPFIND and REPORT with
// multistatus XML built from the fixtures below. It records every request, so a test can check that
// nothing but PROPFIND and REPORT ever arrives. Not a test file: `npm test` only runs `test/**/*.test.ts`.

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
};

const xmlEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function reportBody(collection: string, files: Record<string, string>): string {
  const responses = Object.entries(files)
    .map(
      ([name, data], index) => `  <d:response>
    <d:href>${collection}${name}</d:href>
    <d:propstat>
      <d:prop><d:getetag>"etag-${index}"</d:getetag><cal:calendar-data>${xmlEscape(data)}</cal:calendar-data></d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">\n${responses}\n</d:multistatus>`;
}

function propfindBody(collection: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>${collection}</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Fixture list</d:displayname>
        <d:resourcetype><d:collection/><cal:calendar/></d:resourcetype>
        <cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;
}

export type RecordedRequest = { method: string; url: string; depth: string | undefined; authorization: string | undefined; body: string };

export type FakeCalDav = {
  /** http://127.0.0.1:<port> */
  base: string;
  requests: RecordedRequest[];
  close: () => Promise<void>;
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

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const method = req.method ?? "";
      requests.push({
        method,
        url: req.url ?? "",
        depth: req.headers.depth as string | undefined,
        authorization: req.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
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
      const files = COLLECTIONS[pathname];
      if (!files) {
        res.writeHead(404).end();
        return;
      }
      if (method !== "PROPFIND" && method !== "REPORT") {
        // Nothing in this app writes. If a PUT or DELETE ever arrives, it is recorded above and refused here.
        res.writeHead(405, { allow: "PROPFIND, REPORT" }).end();
        return;
      }
      const body = method === "PROPFIND" ? propfindBody(pathname) : reportBody(pathname, files);
      res.writeHead(207, { "content-type": "application/xml; charset=utf-8", "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const LIST_PATHS = { Aufgaben: "/dav/calendars/test/aufgaben/", Arbeit: "/dav/calendars/test/arbeit/" } as const;

/** Env for loadCalDavConfig that points at a fake server. */
export function fakeEnv(fake: FakeCalDav): NodeJS.ProcessEnv {
  return {
    BUJO_CALDAV_BASE: fake.base,
    BUJO_CALDAV_USER: USER,
    BUJO_CALDAV_PASSWORD: PASSWORD,
    BUJO_CALDAV_LISTS: `Aufgaben=${LIST_PATHS.Aufgaben},Arbeit=${LIST_PATHS.Arbeit}`,
  };
}
