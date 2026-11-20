import http from "node:http";
import type { AddressInfo } from "node:net";
import type { OcrLine, OcrResult } from "../src/scan/ocr-client.ts";

// A fake OCR service for tests: POST /ocr answers a fixed result, and records what it was sent (the byte
// count and content type, never the bytes). It listens on 127.0.0.1 only. Not a test file: `npm test` only
// runs `test/**/*.test.ts`.

export type FakeOcr = {
  /** http://127.0.0.1:<port> */
  url: string;
  requests: Array<{ method: string; path: string; contentType: string | undefined; bytes: number }>;
  /** Replace the answer for the next calls. */
  setLines(lines: OcrLine[]): void;
  /** Answer the next calls with this status and no result (0 = answer normally). */
  failWith(status: number): void;
  /** Never answer (for the timeout test). */
  hang(on: boolean): void;
  close(): Promise<void>;
};

export const line = (symbol: OcrLine["symbol"], text: string, confidence = 0.9, y = 0): OcrLine => ({
  symbol,
  text,
  confidence,
  bbox: [10, 10 + y * 60, 300, 40],
  engine: "fake",
});

/** The page the tests use: the German fixture backlog (test/fake-caldav.ts) matches some of these lines. */
export const DEFAULT_PAGE: OcrLine[] = [
  line("none", "20.11.2026", 0.8, 0),
  line("•", "Milch kaufen", 0.9, 1),
  line("x", "Zahnarzt anrufen", 0.85, 2),
  line(">", "Umzug planen", 0.7, 3),
  line("<", "Müller Grüße ausrichten", 0.6, 4),
  line("○", "Geburtstag Oma", 0.9, 5),
  line("–", "Idee Wochenende", 0.9, 6),
];

export async function startFakeOcr(initial: OcrLine[] = DEFAULT_PAGE): Promise<FakeOcr> {
  let lines = initial;
  let failStatus = 0;
  let hanging = false;
  const requests: FakeOcr["requests"] = [];
  const server = http.createServer((req, res) => {
    let bytes = 0;
    req.on("data", (chunk: Buffer) => (bytes += chunk.length));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", path: req.url ?? "", contentType: req.headers["content-type"], bytes });
      if (hanging) return;
      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        return;
      }
      if (req.method !== "POST" || req.url !== "/ocr") {
        res.writeHead(404).end();
        return;
      }
      if (failStatus) {
        res.writeHead(failStatus, { "content-type": "application/json" }).end('{"error":"nope"}');
        return;
      }
      const result: OcrResult = { lines, width: 900, height: 700, ms: 12 };
      const body = JSON.stringify(result);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
      res.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    setLines: (next) => {
      lines = next;
    },
    failWith: (status) => {
      failStatus = status;
    },
    hang: (on) => {
      hanging = on;
    },
    close: async () => {
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
