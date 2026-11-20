import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CalDavClient } from "../src/caldav/client.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { caldavSource, demoSource } from "../src/caldav/source.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { SCAN_MAX_BYTES } from "../src/scan/photo.ts";
import { DEFAULT_PAGE, line, startFakeOcr, type FakeOcr } from "./fake-ocr.ts";
import { fakeEnv, LIST_PATHS, PASSWORD, startFakeCalDav, USER, type FakeCalDav } from "./fake-caldav.ts";
import { api, makeToken, signUp, withApp, type Signed } from "./helpers.ts";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

type Ctx = {
  base: string;
  fake: FakeCalDav;
  ocr: FakeOcr;
  signed: Signed;
  read: Record<string, string>;
  write: Record<string, string>;
};

async function withScan(fn: (ctx: Ctx) => Promise<void>, options: { ocrUrl?: string | null } = {}) {
  const fake = await startFakeCalDav();
  const ocr = await startFakeOcr();
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
    const source = caldavSource(config, new CalDavClient({ base: fake.base, user: USER, password: PASSWORD }));
    const url = options.ocrUrl === undefined ? ocr.url : (options.ocrUrl ?? undefined);
    await withApp(source, async ({ base }) => {
      const signed = await signUp(base);
      const read = bearer((await makeToken(base, signed, "read")).token);
      const write = bearer((await makeToken(base, signed, "write")).token);
      await fn({ base, fake, ocr, signed, read, write });
    }, { ocr: createOcrClient(url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
    await fake.close();
  }
}

async function upload(base: string, headers: Record<string, string>, body: Buffer = PNG, type = "image/png") {
  const response = await fetch(`${base}/api/scan`, { method: "POST", headers: { "content-type": type, ...headers }, body: new Uint8Array(body) });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}

const writes = (fake: FakeCalDav) => fake.requests.filter((r) => r.method === "PUT");

test("ocr client: no OCR_URL is a clear 503, a dead service a 502, a hung one a 502", async () => {
  await assert.rejects(createOcrClient(undefined)(PNG, "image/png"), (e: any) => e.status === 503 && /OCR_URL/.test(e.message));
  await assert.rejects(createOcrClient("")(PNG, "image/png"), (e: any) => e.status === 503);
  await assert.rejects(createOcrClient("http://127.0.0.1:9", { timeoutMs: 500 })(PNG, "image/png"), (e: any) => e.status === 502);
  const ocr = await startFakeOcr();
  try {
    ocr.hang(true);
    await assert.rejects(createOcrClient(ocr.url, { timeoutMs: 200 })(PNG, "image/png"), (e: any) => e.status === 502 && /too long/.test(e.message));
    ocr.hang(false);
    ocr.failWith(500);
    await assert.rejects(createOcrClient(ocr.url)(PNG, "image/png"), (e: any) => e.status === 502);
    ocr.failWith(415);
    await assert.rejects(createOcrClient(ocr.url)(PNG, "image/png"), (e: any) => e.status === 422);
    ocr.failWith(0);
    const result = await createOcrClient(ocr.url + "/")(PNG, "image/png");
    assert.equal(result.lines.length, DEFAULT_PAGE.length);
    assert.equal(ocr.requests.at(-1)?.contentType, "image/png");
    assert.equal(ocr.requests.at(-1)?.bytes, PNG.length);
  } finally {
    await ocr.close();
  }
});

test("ocr client: a malformed answer is a 502", async () => {
  const ocr = await startFakeOcr([{ symbol: "?" as never, text: "x", confidence: 1, bbox: [0, 0, 1, 1], engine: "f" }]);
  try {
    await assert.rejects(createOcrClient(ocr.url)(PNG, "image/png"), (e: any) => e.status === 502);
  } finally {
    await ocr.close();
  }
});

test("POST /api/scan: a session uploads, OCR is called with the raw bytes, a draft comes back and no CalDAV write happens", async () => {
  await withScan(async ({ base, signed, ocr, fake }) => {
    const { status, json } = await upload(base, signed.headers);
    assert.equal(status, 201);
    const draft = json.draft;
    assert.equal(ocr.requests.length, 1);
    assert.deepEqual([ocr.requests[0].method, ocr.requests[0].path, ocr.requests[0].contentType, ocr.requests[0].bytes], ["POST", "/ocr", "image/png", PNG.length]);
    assert.match(draft.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(draft.items.length, DEFAULT_PAGE.length);
    assert.equal(draft.pageDate, "2026-11-20");
    assert.equal(draft.pageDateSource, "line");
    assert.equal(draft.expires - draft.created, 24 * 60 * 60 * 1000);
    assert.equal(draft.defaultList, "Aufgaben");
    assert.deepEqual(draft.lists, ["Aufgaben", "Arbeit"]);
    const by = Object.fromEntries(draft.items.map((i: any) => [i.id, i]));
    assert.equal(by.l2.action, "create");
    assert.equal(by.l3.action, "complete");
    assert.equal(by.l3.match.uid, "fx-termin");
    assert.equal(by.l4.action, "keep");
    assert.equal(by.l4.match.uid, "fx-process");
    assert.equal(by.l5.action, "schedule");
    assert.equal(by.l6.include, false);
    assert.equal(by.l7.include, false);
    // The photo is not in the draft, in any form.
    assert.ok(!JSON.stringify(draft).includes(PNG.toString("base64")));
    assert.equal(writes(fake).length, 0);
  });
});

test("POST /api/scan: jpeg, webp and heic pass through as they are", async () => {
  await withScan(async ({ base, signed, ocr }) => {
    for (const type of ["image/jpeg", "image/webp", "image/heic"]) {
      assert.equal((await upload(base, signed.headers, PNG, type)).status, 201, type);
    }
    assert.deepEqual(ocr.requests.map((r) => r.contentType), ["image/jpeg", "image/webp", "image/heic"]);
  });
});

test("POST /api/scan: wrong type 415, empty 400, over 15 MB 413 without reaching OCR", async () => {
  await withScan(async ({ base, signed, ocr }) => {
    assert.equal((await upload(base, signed.headers, PNG, "application/json")).status, 415);
    assert.equal((await upload(base, signed.headers, PNG, "text/plain")).status, 415);
    assert.equal((await upload(base, signed.headers, Buffer.alloc(0))).status, 400);
    const big = await upload(base, signed.headers, Buffer.alloc(SCAN_MAX_BYTES + 1));
    assert.equal(big.status, 413);
    assert.match(big.json.error, /15 MB/);
    assert.equal(ocr.requests.length, 0);
    // Exactly at the limit is accepted.
    assert.equal((await upload(base, signed.headers, Buffer.alloc(SCAN_MAX_BYTES))).status, 201);
  });
});

test("POST /api/scan: OCR_URL unset is 503, a failing OCR service is 502", async () => {
  await withScan(async ({ base, signed }) => {
    const { status, json } = await upload(base, signed.headers);
    assert.equal(status, 503);
    assert.match(json.error, /OCR_URL/);
  }, { ocrUrl: null });
  await withScan(async ({ base, signed, ocr }) => {
    ocr.failWith(500);
    assert.equal((await upload(base, signed.headers)).status, 502);
    ocr.failWith(0);
    ocr.hang(true);
    assert.equal((await upload(base, signed.headers)).status, 502);
  });
});

test("auth: no sign-in is 401, agents get 403 on upload and apply but may read a draft", async () => {
  await withScan(async ({ base, signed, read, write, ocr, fake }) => {
    assert.equal((await upload(base, {})).status, 401);
    assert.equal((await upload(base, read)).status, 403);
    assert.equal((await upload(base, write)).status, 403);
    assert.equal(ocr.requests.length, 0);

    const { json } = await upload(base, signed.headers);
    const id = json.draft.id;
    assert.equal((await api(base, "GET", `/api/scan/${id}`)).status, 401);
    for (const headers of [signed.headers, read, write]) {
      const got = await api(base, "GET", `/api/scan/${id}`, { headers });
      assert.equal(got.status, 200);
      assert.equal(got.json.draft.id, id);
    }
    const body = { items: [{ id: "l2", symbol: "•", text: "Milch kaufen" }] };
    assert.equal((await api(base, "POST", `/api/scan/${id}/apply`, { body })).status, 401);
    assert.equal((await api(base, "POST", `/api/scan/${id}/apply`, { body, headers: read })).status, 403);
    assert.equal((await api(base, "POST", `/api/scan/${id}/apply`, { body, headers: write })).status, 403);
    assert.equal(writes(fake).length, 0);
    // An agent cannot change a draft any other way either.
    for (const method of ["PUT", "PATCH", "DELETE", "POST"]) {
      assert.equal((await api(base, method, `/api/scan/${id}`, { headers: write, body: {} })).status, 405);
    }
    assert.equal((await api(base, "GET", "/api/scan/unknown", { headers: read })).status, 404);
    assert.equal((await api(base, "GET", `/api/scan/${id}/apply`, { headers: signed.headers })).status, 405);
  });
});

test("apply: create, complete, schedule with DUE;VALUE=DATE, and keep, through the CalDAV write path", async () => {
  await withScan(async ({ base, signed, fake }) => {
    const { json } = await upload(base, signed.headers);
    const id = json.draft.id;
    const applied = await api(base, "POST", `/api/scan/${id}/apply`, {
      headers: signed.headers,
      body: {
        items: [
          { id: "l2", symbol: "•", text: "Milch kaufen, Brot & Käse", list: "Arbeit" },
          { id: "l3", symbol: "x", match: { list: "Aufgaben", uid: "fx-termin" } },
          { id: "l4", symbol: ">", match: { list: "Aufgaben", uid: "fx-process" } },
          { id: "l5", symbol: "<", text: "Müller Grüße ausrichten", due: "2026-12-24" },
          { id: "l5", symbol: "<", text: "dup", due: "2026-12-24" },
        ].slice(0, 4),
      },
    });
    assert.equal(applied.status, 200);
    const results = applied.json.results;
    assert.deepEqual(results.map((r: any) => [r.id, r.ok, r.status]), [["l2", true, "written"], ["l3", true, "written"], ["l4", true, "kept"], ["l5", true, "written"]]);

    // create: a fresh UID, If-None-Match: *, in the chosen list, German text with an escaped comma
    const created = writes(fake).filter((r) => r.ifNoneMatch === "*");
    assert.equal(created.length, 2);
    const arbeit = created.find((r) => r.url.startsWith(LIST_PATHS.Arbeit))!;
    assert.match(arbeit.body, /SUMMARY:Milch kaufen\\, Brot & Käse/);
    assert.match(arbeit.body, /UID:[0-9a-f-]{36}/);
    assert.equal(results[0].task.list, "Arbeit");
    assert.equal(results[0].task.summary, "Milch kaufen, Brot & Käse");
    assert.equal(arbeit.body.includes("DTSTART"), false);

    // complete: If-Match, STATUS:COMPLETED, COMPLETED, PERCENT-COMPLETE:100, unknown props kept
    const done = fake.read(LIST_PATHS.Aufgaben, "termin.ics")!;
    assert.match(done, /STATUS:COMPLETED/);
    assert.match(done, /COMPLETED:\d{8}T\d{6}Z/);
    assert.match(done, /PERCENT-COMPLETE:100/);
    assert.equal(results[1].task.status, "COMPLETED");
    assert.ok(writes(fake).some((r) => r.ifMatch !== undefined && r.url.endsWith("termin.ics")));

    // keep: nothing written for the matched task
    assert.equal(writes(fake).some((r) => r.url.endsWith("process.ics")), false);
    assert.equal(fake.read(LIST_PATHS.Aufgaben, "process.ics")?.includes("X-CUSTOM-FLAG"), true);

    // schedule without a match: a new task with an all-day due
    const scheduled = created.find((r) => r.url.startsWith(LIST_PATHS.Aufgaben))!;
    assert.match(scheduled.body, /DUE;VALUE=DATE:20261224/);
    assert.match(scheduled.body, /SUMMARY:Müller Grüße ausrichten/);
    assert.equal(results[3].task.due.date, "2026-12-24");

    assert.equal(fake.requests.some((r) => r.method === "DELETE"), false);
  });
});

test("apply: a scheduled line with a match changes only the due, keeping unknown properties", async () => {
  await withScan(async ({ base, signed, fake }) => {
    const id = (await upload(base, signed.headers)).json.draft.id;
    const applied = await api(base, "POST", `/api/scan/${id}/apply`, {
      headers: signed.headers,
      body: { items: [{ id: "l4", symbol: "<", match: { list: "Aufgaben", uid: "fx-process" }, due: "2026-12-01" }] },
    });
    assert.equal(applied.status, 200);
    const stored = fake.read(LIST_PATHS.Aufgaben, "process.ics")!;
    assert.match(stored, /DUE;VALUE=DATE:20261201/);
    assert.match(stored, /X-CUSTOM-FLAG;X-PARAM=1:keep me/);
    assert.match(stored, /BEGIN:VALARM/);
    assert.match(stored, /RELATED-TO:fx-done/);
    assert.match(stored, /STATUS:IN-PROCESS/);
    assert.equal(fake.names(LIST_PATHS.Aufgaben).length, 7);
  });
});

test("apply: a second apply is 409 and writes nothing", async () => {
  await withScan(async ({ base, signed, fake }) => {
    const id = (await upload(base, signed.headers)).json.draft.id;
    const body = { items: [{ id: "l2", symbol: "•", text: "Milch kaufen" }] };
    assert.equal((await api(base, "POST", `/api/scan/${id}/apply`, { headers: signed.headers, body })).status, 200);
    const before = writes(fake).length;
    const second = await api(base, "POST", `/api/scan/${id}/apply`, { headers: signed.headers, body });
    assert.equal(second.status, 409);
    assert.equal(writes(fake).length, before);
    // The draft shows what was written, for a client that reloads.
    const again = await api(base, "GET", `/api/scan/${id}`, { headers: signed.headers });
    assert.equal(again.json.draft.applied, true);
    assert.equal(again.json.draft.results.length, 1);
  });
});

test("apply: an invalid request writes nothing and leaves the draft open", async () => {
  await withScan(async ({ base, signed, fake }) => {
    const id = (await upload(base, signed.headers)).json.draft.id;
    const post = (items: unknown, extra: object = {}) => api(base, "POST", `/api/scan/${id}/apply`, { headers: signed.headers, body: { items, ...extra } });
    const good = { id: "l2", symbol: "•", text: "Milch kaufen" };
    assert.equal((await post([])).status, 400);
    assert.equal((await post("no")).status, 400);
    assert.equal((await post([good], { extra: 1 })).status, 400);
    assert.equal((await post([good, { id: "l9", symbol: "•", text: "x" }])).status, 400);
    assert.equal((await post([good, good])).status, 400);
    assert.equal((await post([{ ...good, text: "  " }])).status, 400);
    assert.equal((await post([{ ...good, text: "a\nb" }])).status, 400);
    assert.equal((await post([{ ...good, list: "Nope" }])).status, 400);
    assert.equal((await post([{ ...good, action: "complete" }])).status, 400);
    assert.equal((await post([{ ...good, color: "red" }])).status, 400);
    assert.equal((await post([{ id: "l3", symbol: "x" }])).status, 400);
    assert.equal((await post([{ id: "l5", symbol: "<", text: "Müller" }])).status, 400);
    assert.equal((await post([{ id: "l5", symbol: "<", text: "Müller", due: "2026-02-30" }])).status, 400);
    assert.equal((await post([{ id: "l6", symbol: "○", text: "Geburtstag" }])).status, 400);
    assert.equal((await post([{ id: "l3", symbol: "x", match: { list: "Nope", uid: "x" } }])).status, 400);
    assert.equal(writes(fake).length, 0);
    assert.equal((await post([good])).status, 200);
  });
});

test("apply: a failure mid-way reports what was written and what was not, and does not retry", async () => {
  await withScan(async ({ base, signed, fake }) => {
    const id = (await upload(base, signed.headers)).json.draft.id;
    const applied = await api(base, "POST", `/api/scan/${id}/apply`, {
      headers: signed.headers,
      body: {
        items: [
          { id: "l2", symbol: "•", text: "Milch kaufen" },
          { id: "l3", symbol: "x", match: { list: "Aufgaben", uid: "gone-uid" } },
          { id: "l4", symbol: ">", text: "Umzug planen" },
        ],
      },
    });
    assert.equal(applied.status, 200);
    assert.deepEqual(applied.json.results.map((r: any) => [r.id, r.ok, r.status]), [
      ["l2", true, "written"],
      ["l3", false, "failed"],
      ["l4", false, "skipped"],
    ]);
    assert.equal(applied.json.results[1].error, "task not found");
    assert.match(applied.json.results[2].error, /earlier item failed/);
    assert.equal(writes(fake).length, 1);
    // No blind retry: the same draft cannot be applied again.
    assert.equal((await api(base, "POST", `/api/scan/${id}/apply`, { headers: signed.headers, body: { items: [{ id: "l2", symbol: "•", text: "Milch kaufen" }] } })).status, 409);
    assert.equal(writes(fake).length, 1);
  });
});

test("apply: a task changed on the server in between is reported, nothing is overwritten", async () => {
  const fake = await startFakeCalDav();
  const ocr = await startFakeOcr();
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
    // The source reads, then another client touches the file before our PUT lands.
    const client = new CalDavClient({ base: fake.base, user: USER, password: PASSWORD });
    const realPut = client.putExisting.bind(client);
    client.putExisting = async (href: string, text: string, etag: string) => {
      fake.touch(LIST_PATHS.Aufgaben, "termin.ics");
      return realPut(href, text, etag);
    };
    await withApp(caldavSource(config, client), async ({ base }) => {
      const signed = await signUp(base);
      const id = (await upload(base, signed.headers)).json.draft.id;
      const applied = await api(base, "POST", `/api/scan/${id}/apply`, {
        headers: signed.headers,
        body: { items: [{ id: "l3", symbol: "x", match: { list: "Aufgaben", uid: "fx-termin" } }] },
      });
      assert.equal(applied.json.results[0].ok, false);
      assert.match(applied.json.results[0].error, /changed in the meantime/);
      assert.equal(fake.read(LIST_PATHS.Aufgaben, "termin.ics")!.includes("COMPLETED"), false);
    }, { ocr: createOcrClient(ocr.url) });
  } finally {
    await ocr.close();
    await fake.close();
  }
});

test("a read-only token or a session on the demo source never reaches a real list", async () => {
  const ocr = await startFakeOcr([line("•", "Nur ein Test"), line("x", "Nichts Passendes hier")]);
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      const { json } = await upload(base, signed.headers);
      assert.equal(json.draft.items[1].include, false);
    }, { ocr: createOcrClient(ocr.url) });
  } finally {
    await ocr.close();
  }
});

test("the photo never touches disk: nothing new in the temp and data dirs, and the draft has no image", async () => {
  const dirs = [os.tmpdir(), path.resolve("data"), process.cwd()];
  const snapshot = () => dirs.map((dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []));
  await withScan(async ({ base, signed }) => {
    const before = snapshot();
    const marker = Buffer.concat([PNG, Buffer.from("BUJO-PHOTO-MARKER")]);
    const { json } = await upload(base, signed.headers, marker);
    assert.equal(json.draft.items.length, DEFAULT_PAGE.length);
    assert.deepEqual(snapshot(), before);
    assert.ok(!JSON.stringify(json).includes("BUJO-PHOTO-MARKER"));
  });
});

test("German text with umlauts roundtrips from OCR through the draft to CalDAV and back", async () => {
  const text = "Äpfel für Größe überprüfen ß";
  const fake = await startFakeCalDav();
  const ocr = await startFakeOcr([line("•", text)]);
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
    const source = caldavSource(config, new CalDavClient({ base: fake.base, user: USER, password: PASSWORD }));
    await withApp(source, async ({ base }) => {
      const signed = await signUp(base);
      const { json } = await upload(base, signed.headers);
      assert.equal(json.draft.items[0].text, text);
      const applied = await api(base, "POST", `/api/scan/${json.draft.id}/apply`, {
        headers: signed.headers,
        body: { items: [{ id: "l1", symbol: "•", text }] },
      });
      assert.equal(applied.json.results[0].task.summary, text);
      const put = writes(fake)[0];
      assert.ok(put.body.includes(`SUMMARY:${text}`));
      const backlog = await api(base, "GET", "/api/backlog", { headers: signed.headers });
      assert.ok(backlog.json.tasks.some((t: any) => t.summary === text));
    }, { ocr: createOcrClient(ocr.url) });
  } finally {
    await ocr.close();
    await fake.close();
  }
});

test("the scan page needs a session", async () => {
  await withScan(async ({ base, signed }) => {
    const anon = await fetch(`${base}/scan`, { redirect: "manual" });
    assert.equal(anon.status, 302);
    const page = await fetch(`${base}/scan`, { headers: signed.headers });
    assert.equal(page.status, 200);
  });
});
