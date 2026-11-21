import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { demoSource } from "../src/caldav/source.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { openDb } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import { linesToMarkdown, noteTitle, suggestNote } from "../src/log/scan/note.ts";
import { BODY_MAX, TITLE_MAX, checkEntryPatch, checkNewEntry } from "../src/log/validation.ts";
import { createOcrClient } from "../src/scan/ocr-client.ts";
import { createSyncService } from "../src/sync/service.ts";
import { SYNC_SETTINGS, startFakeCalDav, syncEnv } from "./fake-caldav.ts";
import { line, startFakeOcr } from "./fake-ocr.ts";
import { api, signUp, withApp } from "./helpers.ts";

const DAY = "2026-11-20";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("noteTitle strips heading markers, tidies spaces and caps the length", () => {
  assert.equal(noteTitle("# Küchengarten, Frühjahr"), "Küchengarten, Frühjahr");
  assert.equal(noteTitle("### Drei  Hashes "), "Drei Hashes");
  assert.equal(noteTitle("#hashtag stays"), "#hashtag stays");
  assert.equal(noteTitle("#"), "");
  assert.equal(noteTitle("   "), "");
  assert.equal(noteTitle("x".repeat(TITLE_MAX + 50)).length, TITLE_MAX);
});

test("linesToMarkdown joins the OCR lines with newlines, prefixes bullets and drops empty lines", () => {
  const lines = [line("none", "# Küchengarten"), line("none", "  "), line("•", "Beet 2"), line("–", "Trellis"), line("x", "Samen bestellt"), line("none", "Next: plan")];
  assert.equal(linesToMarkdown(lines), "# Küchengarten\n- Beet 2\n- Trellis\n- [x] Samen bestellt\nNext: plan");
  assert.equal(linesToMarkdown([]), "");
});

test("suggestNote: title from the first line, header date taken out of the text, fallback day otherwise", () => {
  const withHeader = suggestNote([line("none", "20.11.2026"), line("none", "## Kompost"), line("•", "umschichten")], "2026-11-01");
  assert.deepEqual(withHeader, { title: "Kompost", date: DAY, dateFromPage: true, body: "## Kompost\n- umschichten" });

  const plain = suggestNote([line("none", "Ein Gedanke"), line("none", "zweite Zeile")], "2026-11-01");
  assert.deepEqual(plain, { title: "Ein Gedanke", date: "2026-11-01", dateFromPage: false, body: "Ein Gedanke\nzweite Zeile" });

  const empty = suggestNote([line("none", "  ")], "2026-11-01");
  assert.deepEqual(empty, { title: "", date: "2026-11-01", dateFromPage: false, body: "" });
  assert.equal(suggestNote([line("none", "#")], "2026-11-01").title, "");
});

test("checks: body is optional, blank means none, long or binary text is refused", () => {
  const base = { date: DAY, type: "note", title: "Notiz" };
  assert.deepEqual((checkNewEntry(base) as any).value.body, null);
  assert.equal((checkNewEntry({ ...base, body: "  \n " }) as any).value.body, null);
  assert.equal((checkNewEntry({ ...base, body: "a\r\nb\n\n- c" }) as any).value.body, "a\nb\n\n- c");
  assert.equal(checkNewEntry({ ...base, body: 4 }).ok, false);
  assert.equal(checkNewEntry({ ...base, body: "x".repeat(BODY_MAX + 1) }).ok, false);
  assert.equal(checkNewEntry({ ...base, body: "a\u0000b" }).ok, false);
  assert.deepEqual(checkEntryPatch({ body: "# neu" }), { ok: true, value: { body: "# neu" } });
  assert.deepEqual(checkEntryPatch({ body: null }), { ok: true, value: { body: null } });
});

test("the store keeps body, a patch edits it, and an entry without one stays null", () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('u', 'P', 'h', 1)").run();
  const store = createEntryStore(db);
  const short = store.create("u", { date: DAY, type: "note", title: "kurz", tag: null, time: null }, 1);
  const note = store.create("u", { date: DAY, type: "note", title: "lang", tag: null, time: null, body: "# lang\n- eins" }, 2);
  assert.equal(short.body, null);
  assert.equal(note.body, "# lang\n- eins");
  assert.equal(store.update("u", note.id, { body: "# lang\n- zwei" }, 3)!.body, "# lang\n- zwei");
  assert.equal(store.update("u", short.id, { title: "kurz 2" }, 3)!.body, null);
  assert.equal(store.update("u", note.id, { title: "neu" }, 4)!.body, "# lang\n- zwei", "an edit of another field keeps the body");
  assert.equal(store.update("u", note.id, { body: null }, 5)!.body, null);
});

test("opening an older database file adds the body column and keeps its rows", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bujo-migrate-"));
  const file = path.join(dir, "old.db");
  try {
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, email_verified_at INTEGER, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT, type TEXT NOT NULL, title TEXT NOT NULL, tag TEXT,
        sync TEXT NOT NULL DEFAULT 'local', position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      INSERT INTO users VALUES ('u', 'P', NULL, NULL, 'h', 1);
      INSERT INTO entries VALUES ('e1', 'u', '${DAY}', NULL, 'note', 'alt', NULL, 'local', 0, 1, 1);`);
    old.close();
    const db = openDb(file);
    const store = createEntryStore(db);
    assert.equal(store.get("u", "e1")!.body, null);
    assert.equal(store.update("u", "e1", { body: "# alt" }, 2)!.body, "# alt");
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("/api/entries: a free note keeps its markdown, lists it, a PATCH edits it, short notes show body null", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const headers = signed.headers;
    const created = await api(base, "POST", "/api/entries", { headers, body: { date: DAY, type: "note", title: "Küchengarten", body: "# Küchengarten\n- Beet 2" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.entry.body, "# Küchengarten\n- Beet 2");
    assert.equal(created.json.entry.sync, "local");
    const short = await api(base, "POST", "/api/entries", { headers, body: { date: DAY, type: "note", title: "kurz" } });
    assert.equal(short.json.entry.body, null);

    const patched = await api(base, "PATCH", `/api/entries/${created.json.entry.id}`, { headers, body: { body: "# Küchengarten\n- Beet 3", title: "Garten" } });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.entry.body, "# Küchengarten\n- Beet 3");
    assert.equal(patched.json.entry.title, "Garten");

    const list = await api(base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers });
    assert.deepEqual(list.json.entries.map((e: any) => [e.title, e.body]), [["Garten", "# Küchengarten\n- Beet 3"], ["kurz", null]]);
    assert.equal((await api(base, "PATCH", `/api/entries/${short.json.entry.id}`, { headers, body: { body: 5 } })).status, 400);
  });
});

test("POST /api/log/scan/note: answers a suggestion and writes nothing; a failing OCR and a bad request are refused", async () => {
  const ocr = await startFakeOcr([]);
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      const post = (query: string, headers: Record<string, string>, body: Buffer = PNG, type = "image/png") =>
        fetch(`${base}/api/log/scan/note${query}`, { method: "POST", headers: { "content-type": type, ...headers }, body: new Uint8Array(body) });
      ocr.setLines([line("none", "# Küchengarten, Frühjahr"), line("•", "Beet 2: Rucola")]);
      const ok = await post("?date=2026-11-19", signed.headers);
      assert.equal(ok.status, 200);
      assert.deepEqual((await ok.json()).note, { title: "Küchengarten, Frühjahr", date: "2026-11-19", dateFromPage: false, body: "# Küchengarten, Frühjahr\n- Beet 2: Rucola" });
      assert.equal(ocr.requests.length, 1);
      const entries = await api(base, "GET", "/api/entries?from=2026-10-01&to=2026-12-31", { headers: signed.headers });
      assert.deepEqual(entries.json.entries, []);

      assert.equal((await post("", {})).status, 401);
      assert.equal((await post("?date=nope", signed.headers)).status, 400);
      assert.equal((await post("", signed.headers, Buffer.from("x"), "text/plain")).status, 415);
      assert.equal((await api(base, "GET", "/api/log/scan/note", { headers: signed.headers })).status, 405);
      ocr.failWith(500);
      assert.equal((await post("", signed.headers)).status, 502);
    }, { ocr: createOcrClient(ocr.url, { timeoutMs: 1500 }) });
  } finally {
    await ocr.close();
  }
});

test("a free note is never queued for CalDAV: the sync service leaves it local and sends nothing", async () => {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES ('u', 'P', 'h', 1)").run();
  try {
    const service = createSyncService({ db, caldav: loadCalDavConfig(syncEnv(fake))!, sync: { ...SYNC_SETTINGS }, log: () => undefined });
    const note = createEntryStore(db).create("u", { date: DAY, type: "note", title: "Notiz", tag: null, time: null, body: "# Notiz" }, 1);
    const answered = service.enqueue("u", note);
    await service.idle();
    assert.equal(answered.sync, "local");
    assert.equal(createEntryStore(db).get("u", note.id)!.sync, "local");
    assert.equal(fake.requests.filter((request) => request.method === "PUT").length, 0);
  } finally {
    db.close();
    await fake.close();
  }
});
