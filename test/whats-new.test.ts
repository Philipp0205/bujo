import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { demoSource } from "../src/caldav/source.ts";
import { PUBLIC_DIR } from "../src/app.ts";
import { openDb } from "../src/db.ts";
import { createCatalog } from "../src/whats-new/catalog.ts";
import { getSeen, setSeen } from "../src/whats-new/store.ts";
import { api, signUp, withApp } from "./helpers.ts";

type Entry = { id: string; date: string; title: string; bullets: string[] };
const IDS = ["2026-11-21-new", "2026-11-21-mid", "2026-11-21-old"];
const ENTRIES: Entry[] = IDS.map((id) => ({ id, date: "2026-11-21", title: id, bullets: ["x"] }));

/** A page-like sandbox: the kit and the client seen.js, with a fake localStorage and a fake account API. */
function clientSeen(options: { local?: string; account?: string; accountFails?: boolean }) {
  const store = new Map<string, string>();
  if (options.local) store.set("bujo-whats-new-seen", options.local);
  const calls: Array<{ method: string; body?: unknown }> = [];
  const sandbox: Record<string, any> = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    Bujo: {
      request: async (method: string, _path: string, body?: unknown) => {
        calls.push({ method, body });
        if (options.accountFails) throw new Error("offline");
        return method === "GET" ? { seen: options.account ?? null } : { seen: (body as { id: string }).id };
      },
    },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "app-kit", "ak-whats-new.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(PUBLIC_DIR, "js", "whats-new", "seen.js"), "utf8"), sandbox);
  return { seen: sandbox.BujoWhatsNew.seen, store, calls, kit: sandbox.AppKit.whatsNew };
}

test("seen state: the newer of the device id and the account id wins", async () => {
  const cases: Array<[string | undefined, string | undefined, string]> = [
    ["2026-11-21-old", "2026-11-21-mid", "2026-11-21-mid"],
    ["2026-11-21-new", "2026-11-21-old", "2026-11-21-new"],
    ["", "2026-11-21-mid", "2026-11-21-mid"],
    ["2026-11-21-mid", "", "2026-11-21-mid"],
    ["", "", ""],
  ];
  for (const [local, account, expected] of cases) {
    const client = clientSeen({ local, account });
    assert.equal(await client.seen.current(ENTRIES), expected, `${local} + ${account}`);
  }
});

test("seen state: a failing account call falls back to the device id, and nothing seen means all entries are unseen", async () => {
  const offline = clientSeen({ local: "2026-11-21-mid", accountFails: true });
  assert.equal(await offline.seen.current(ENTRIES), "2026-11-21-mid");
  const fresh = clientSeen({});
  const seen = await fresh.seen.current(ENTRIES);
  assert.equal(seen, "");
  assert.equal(fresh.kit.unseenEntries(ENTRIES, seen).length, 3);
  assert.deepEqual(fresh.kit.unseenEntries(ENTRIES, "2026-11-21-mid").map((e: Entry) => e.id), ["2026-11-21-new"]);
});

test("seen state: remember writes the device and the account, and refuses an invalid id", async () => {
  const client = clientSeen({});
  assert.equal(await client.seen.remember("2026-11-21-new"), true);
  assert.equal(client.store.get("bujo-whats-new-seen"), "2026-11-21-new");
  assert.equal(JSON.stringify(client.calls), JSON.stringify([{ method: "PUT", body: { id: "2026-11-21-new" } }]));
  assert.equal(await client.seen.remember("Not Valid!"), false);
  assert.equal(await client.seen.remember(null), false);
  assert.equal(client.calls.length, 1);
});

test("the shipped whats-new.json passes the kit's rules, newest first, with unique date-based ids", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC_DIR, "whats-new.json"), "utf8")) as unknown[];
  const kit = clientSeen({}).kit;
  const kept = kit.normalizeEntries(raw) as Entry[];
  assert.ok(kept.length > 0);
  assert.equal(kept.length, raw.length, "no entry is dropped by normalizeEntries");
  for (const entry of kept) assert.match(entry.id, /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/);
  assert.equal(JSON.stringify(raw).includes("\u2014"), false, "no em dash");
  assert.equal(createCatalog(PUBLIC_DIR).latestId(), kept[0].id);
});

test("sign-up writes the newest catalog id onto the new account", async () => {
  await withApp(demoSource(), async ({ base, db }) => {
    const signed = await signUp(base);
    const latest = createCatalog(PUBLIC_DIR).latestId();
    assert.ok(latest);
    const row = db.prepare("SELECT whats_new_seen AS seen FROM users").get() as { seen: string };
    assert.equal(row.seen, latest);
    const read = await api(base, "GET", "/api/whats-new/seen", { headers: signed.headers });
    assert.equal(read.json.seen, latest);
  });
});

test("sign-up with an empty catalog leaves the seen id empty", async () => {
  const dir = fs.mkdtempSync("/tmp/opencode/bujo-wn-empty-");
  fs.cpSync(path.join(PUBLIC_DIR, "app-kit"), path.join(dir, "app-kit"), { recursive: true });
  fs.writeFileSync(path.join(dir, "whats-new.json"), "[]");
  await withApp(demoSource(), async ({ base, db }) => {
    await signUp(base);
    const row = db.prepare("SELECT whats_new_seen AS seen FROM users").get() as { seen: string | null };
    assert.equal(row.seen, null);
  }, { publicDir: dir });
});

test("the seen API is session only, validates the id, and stores it per account", async () => {
  await withApp(demoSource(), async ({ base }) => {
    assert.equal((await api(base, "GET", "/api/whats-new/seen")).status, 401);
    assert.equal((await api(base, "PUT", "/api/whats-new/seen", { body: { id: "a" } })).status, 401);
    const { headers } = await signUp(base);

    const put = await api(base, "PUT", "/api/whats-new/seen", { body: { id: "2026-11-21-old" }, headers });
    assert.equal(put.status, 200);
    assert.equal((await api(base, "GET", "/api/whats-new/seen", { headers })).json.seen, "2026-11-21-old");

    for (const id of ["", "UPPER", "has space", "x".repeat(65), 5, null, undefined]) {
      const bad = await api(base, "PUT", "/api/whats-new/seen", { body: { id }, headers });
      assert.equal(bad.status, 400, JSON.stringify(id));
    }
    assert.equal((await api(base, "GET", "/api/whats-new/seen", { headers })).json.seen, "2026-11-21-old");
    assert.equal((await api(base, "POST", "/api/whats-new/seen", { body: { id: "a" }, headers })).status, 405);
  });
});

test("the seen API refuses an agent token", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const signed = await signUp(base);
    const made = await api(base, "POST", "/api/tokens", { body: { name: "bot", scope: "write" }, headers: signed.headers });
    const bearer = { authorization: `Bearer ${made.json.token}` };
    assert.equal((await api(base, "GET", "/api/whats-new/seen", { headers: bearer })).status, 403);
    assert.equal((await api(base, "PUT", "/api/whats-new/seen", { body: { id: "a" }, headers: bearer })).status, 403);
  });
});

test("an old database without whats_new_seen is migrated on open, safe twice, and its user reads as nothing seen", () => {
  const file = `/tmp/opencode/bujo-wn-migrate-${process.pid}-${Date.now()}.db`;
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, email_verified_at INTEGER, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    INSERT INTO users VALUES ('u', 'T', NULL, NULL, 'h', 1);
  `);
  old.close();
  for (let round = 0; round < 2; round++) {
    const db = openDb(file);
    const columns = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(columns.includes("whats_new_seen"));
    assert.equal(getSeen(db, "u"), round === 0 ? null : "2026-11-21-old");
    setSeen(db, "u", "2026-11-21-old");
    assert.equal(getSeen(db, "u"), "2026-11-21-old");
    db.close();
  }
});
