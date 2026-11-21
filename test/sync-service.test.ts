import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { CalDavClient } from "../src/caldav/client.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { demoSource } from "../src/caldav/source.ts";
import { openDb, type Db } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import type { Entry, NewEntry } from "../src/log/types.ts";
import { createSyncService, failInterrupted, type SyncService } from "../src/sync/service.ts";
import { fakeEnv, LIST_PATHS, PASSWORD, startFakeCalDav, SYNC_SETTINGS, syncEnv, USER, type FakeCalDav } from "./fake-caldav.ts";
import { api, signUp, withApp } from "./helpers.ts";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const BOX = LIST_PATHS["bujo-test"];
const USER_ID = "user-1";
const UMLAUT = "Müller anrufen für Übergabe";

type Ctx = { fake: FakeCalDav; db: Db; service: SyncService; entries: ReturnType<typeof createEntryStore>; logs: string[] };

/** The sync service over an in-memory db and the fake server. Nothing here reaches a real list. */
async function withSync(
  fn: (ctx: Ctx) => Promise<void>,
  options: { env?: NodeJS.ProcessEnv; sync?: { listName: string; live: boolean }; client?: (fake: FakeCalDav) => CalDavClient } = {},
): Promise<void> {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, 'T', 'h', 1)").run(USER_ID);
  try {
    const caldav = loadCalDavConfig(options.env ?? syncEnv(fake))!;
    let n = 0;
    const logs: string[] = [];
    const service = createSyncService({
      db,
      caldav,
      sync: options.sync ?? { ...SYNC_SETTINGS },
      client: options.client?.(fake),
      now: () => NOW,
      uuid: () => `uid-${++n}`,
      log: (message) => logs.push(message),
    });
    await fn({ fake, db, service, entries: createEntryStore(db), logs });
  } finally {
    db.close();
    await fake.close();
  }
}

const NEW: NewEntry = { date: "2026-11-24", type: "task", title: UMLAUT, tag: "Haushalt", time: null };
const make = (ctx: Ctx, patch: Partial<NewEntry> = {}): Entry => ctx.entries.create(USER_ID, { ...NEW, ...patch }, NOW);
const puts = (fake: FakeCalDav) => fake.requests.filter((request) => request.method === "PUT");
const stored = (fake: FakeCalDav, uid = "uid-1") => fake.read(BOX, `${uid}.ics`)!;
const reread = (ctx: Ctx, id: string) => ctx.entries.get(USER_ID, id)!;

test("create: the entry answers pending at once, then the push is a PUT with If-None-Match: *, read back, and synced", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    assert.equal(created.sync, "local");
    const answered = ctx.service.enqueue(USER_ID, created);
    assert.equal(answered.sync, "pending");
    assert.equal(puts(ctx.fake).length, 0, "nothing is sent before enqueue returns control");

    await ctx.service.idle();
    const entry = reread(ctx, created.id);
    assert.equal(entry.sync, "synced");
    assert.equal(entry.syncError, null);

    const [put] = puts(ctx.fake);
    assert.equal(put.ifNoneMatch, "*");
    assert.equal(put.ifMatch, undefined);
    assert.equal(put.url, `${BOX}uid-1.ics`);
    assert.equal(ctx.fake.requests.at(-1)!.method, "GET", "the last request is the read-back");
    assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"]);

    const ics = stored(ctx.fake);
    assert.ok(ics.includes("UID:uid-1"));
    assert.ok(ics.includes(`SUMMARY:${UMLAUT}`.replace(/,/g, "\\,")));
    assert.ok(ics.includes("STATUS:NEEDS-ACTION"));
    assert.equal(/DTSTART|CATEGORIES|PRIORITY/.test(ics), false, "the tag is not mapped");
    assert.deepEqual(ctx.entries.getRemote(USER_ID, created.id), { href: `${ctx.fake.base}${BOX}uid-1.ics`, uid: "uid-1", etag: '"etag-v1"' });
  });
});

test("every new entry gets a fresh UID", async () => {
  await withSync(async (ctx) => {
    ctx.service.enqueue(USER_ID, make(ctx, { title: "eins" }));
    ctx.service.enqueue(USER_ID, make(ctx, { title: "zwei" }));
    await ctx.service.idle();
    assert.deepEqual(ctx.fake.names(BOX).sort(), ["uid-1.ics", "uid-2.ics"]);
  });
});

test("update: an edit is a GET, a PUT with If-Match: <etag>, and a read-back, and unknown properties stay", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    // Another client adds properties to the object. They must survive our edit.
    const foreign = stored(ctx.fake).replace("END:VTODO", "X-OTHER-FLAG:keep me\r\nPRIORITY:5\r\nEND:VTODO");
    ctx.fake.touch(BOX, "uid-1.ics", foreign);
    const etagBefore = ctx.fake.requests.length;

    const edited = ctx.entries.update(USER_ID, created.id, { type: "scheduled", title: "Müller zurückrufen" }, NOW)!;
    assert.equal(ctx.service.enqueue(USER_ID, edited).sync, "pending");
    await ctx.service.idle();

    assert.equal(reread(ctx, created.id).sync, "synced");
    const [, update] = puts(ctx.fake);
    assert.match(update.ifMatch!, /^"etag-v\d+"$/);
    assert.equal(update.ifNoneMatch, undefined);
    assert.equal(ctx.fake.requests.slice(etagBefore).map((r) => r.method).join(), "GET,PUT,GET");
    assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"], "the same object, no second one");

    const ics = stored(ctx.fake);
    assert.ok(ics.includes("X-OTHER-FLAG:keep me"));
    assert.ok(ics.includes("PRIORITY:5"));
    assert.ok(ics.includes("SUMMARY:Müller zurückrufen"));
    assert.ok(ics.includes("DUE;VALUE=DATE:20261124"));
    assert.equal(ics.includes("DTSTART"), false);
  });
});

test("done completes the VTODO, and task again reopens it", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();

    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { type: "done" }, NOW)!);
    await ctx.service.idle();
    assert.equal(reread(ctx, created.id).sync, "synced");
    for (const line of ["STATUS:COMPLETED", "COMPLETED:20261120T100000Z", "PERCENT-COMPLETE:100"]) assert.ok(stored(ctx.fake).includes(line), line);

    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { type: "task" }, NOW)!);
    await ctx.service.idle();
    assert.equal(reread(ctx, created.id).sync, "synced");
    assert.ok(stored(ctx.fake).includes("STATUS:NEEDS-ACTION"));
    assert.equal(/COMPLETED:|PERCENT-COMPLETE/.test(stored(ctx.fake)), false);
  });
});

test("an entry that moves to a note goes back to local and writes nothing", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    const before = puts(ctx.fake).length;
    const moved = ctx.entries.update(USER_ID, created.id, { type: "note" }, NOW)!;
    assert.equal(ctx.service.enqueue(USER_ID, moved).sync, "local");
    await ctx.service.idle();
    assert.equal(puts(ctx.fake).length, before);
  });
});

test("notes are never sent", async () => {
  await withSync(async (ctx) => {
    const answered = ctx.service.enqueue(USER_ID, make(ctx, { type: "note", title: "a note" }));
    assert.equal(answered.sync, "local");
    await ctx.service.idle();
    assert.deepEqual(ctx.fake.requests, []);
  });
});

test("a 412 on update is a conflict error: no retry loop, no overwrite", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    const before = stored(ctx.fake);

    ctx.fake.switches.conflictOnPut = true;
    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { title: "anders" }, NOW)!);
    await ctx.service.idle();

    const entry = reread(ctx, created.id);
    assert.equal(entry.sync, "error");
    assert.match(entry.syncError!, /changed this task at the same moment/);
    assert.equal(stored(ctx.fake), before);
    assert.equal(puts(ctx.fake).length, 2, "one create, one refused update, nothing more");
  });
});

test("a real race: the object changes between our GET and our PUT, and the 412 leaves the other change alone", async () => {
  let touch = false;
  await withSync(
    async (ctx) => {
      const created = make(ctx);
      ctx.service.enqueue(USER_ID, created);
      await ctx.service.idle();
      touch = true;
      ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { title: "meiner" }, NOW)!);
      await ctx.service.idle();
      assert.equal(reread(ctx, created.id).sync, "error");
      assert.ok(stored(ctx.fake).includes("von jemand anderem"));
      assert.equal(stored(ctx.fake).includes("meiner"), false);
    },
    {
      client: (fake) =>
        new CalDavClient({
          base: fake.base,
          user: USER,
          password: PASSWORD,
          fetch: async (input, init) => {
            const response = await fetch(input, init);
            if (touch && init?.method === "GET") fake.touch(BOX, "uid-1.ics", fake.read(BOX, "uid-1.ics")!.replace(/SUMMARY:.*/, "SUMMARY:von jemand anderem"));
            return response;
          },
        }),
    },
  );
});

test("a 412 on create is a conflict error too", async () => {
  await withSync(async (ctx) => {
    ctx.fake.switches.conflictOnPut = true;
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    assert.equal(reread(ctx, created.id).sync, "error");
    assert.match(reread(ctx, created.id).syncError!, /same moment/);
    assert.equal(ctx.entries.getRemote(USER_ID, created.id), undefined);
  });
});

test("a read-back that differs is an error, and a retry updates the same object instead of creating another", async () => {
  await withSync(async (ctx) => {
    ctx.fake.switches.corruptReadBack = true;
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();

    const failed = reread(ctx, created.id);
    assert.equal(failed.sync, "error");
    assert.match(failed.syncError!, /did not keep what was sent/);
    assert.equal(ctx.entries.getRemote(USER_ID, created.id)?.uid, "uid-1", "the written object is remembered");

    ctx.fake.switches.corruptReadBack = false;
    ctx.service.enqueue(USER_ID, failed);
    await ctx.service.idle();
    assert.equal(reread(ctx, created.id).sync, "synced");
    assert.equal(reread(ctx, created.id).syncError, null);
    assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"], "no duplicate");
  });
});

test("a failed read-back GET after a good PUT keeps the link, so the retry cannot duplicate", async () => {
  let failGet = true;
  await withSync(
    async (ctx) => {
      const created = make(ctx);
      ctx.service.enqueue(USER_ID, created);
      await ctx.service.idle();
      assert.equal(reread(ctx, created.id).sync, "error");
      assert.equal(ctx.entries.getRemote(USER_ID, created.id)?.uid, "uid-1");
      failGet = false;
      ctx.service.enqueue(USER_ID, reread(ctx, created.id));
      await ctx.service.idle();
      assert.equal(reread(ctx, created.id).sync, "synced");
      assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"]);
    },
    {
      client: (fake) =>
        new CalDavClient({
          base: fake.base,
          user: USER,
          password: PASSWORD,
          fetch: async (input, init) => (failGet && init?.method === "GET" ? new Response(null, { status: 500 }) : fetch(input, init)),
        }),
    },
  );
});

test("the server is down: error with a plain message and no URL in it", async () => {
  await withSync(async (ctx) => {
    await ctx.fake.close();
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    const entry = reread(ctx, created.id);
    assert.equal(entry.sync, "error");
    assert.equal(entry.syncError, "Nextcloud did not answer.");
    assert.equal(/http|127\.0\.0\.1|dav/.test(entry.syncError!), false);
  }).catch((error) => {
    // The helper closes the fake a second time. Only that is allowed to throw.
    if (!/not running/i.test(String(error))) throw error;
  });
});

test("no request is ever a DELETE, across create, edit, conflict and retry", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { type: "done" }, NOW)!);
    await ctx.service.idle();
    ctx.fake.switches.conflictOnPut = true;
    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { title: "x" }, NOW)!);
    await ctx.service.idle();
    ctx.fake.switches.conflictOnPut = false;
    ctx.service.enqueue(USER_ID, reread(ctx, created.id));
    await ctx.service.idle();
    const methods = new Set(ctx.fake.requests.map((request) => request.method));
    assert.deepEqual([...methods].sort(), ["GET", "PUT"]);
    assert.equal(methods.has("DELETE"), false);
  });
});

test("two quick edits of one entry are pushed one after the other: one VTODO, newest text, synced", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx, { title: "eins" });
    ctx.service.enqueue(USER_ID, created);
    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { title: "zwei" }, NOW)!);
    ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { title: "drei" }, NOW)!);
    await ctx.service.idle();
    assert.equal(reread(ctx, created.id).sync, "synced");
    assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"]);
    assert.ok(stored(ctx.fake).includes("SUMMARY:drei"));
  });
});

// ----- the guard, end to end -----

test("the guard: a sync list named Aufgaben or Arbeit is refused with sync=error and nothing is sent", async () => {
  for (const listName of ["Aufgaben", "Arbeit"]) {
    await withSync(
      async (ctx) => {
        const created = make(ctx);
        const answered = ctx.service.enqueue(USER_ID, created);
        assert.equal(answered.sync, "error");
        assert.match(answered.syncError!, /switched off/);
        await ctx.service.idle();
        assert.deepEqual(ctx.fake.requests, [], `${listName} was reached`);
        assert.equal(reread(ctx, created.id).sync, "error");
      },
      { sync: { listName, live: false } },
    );
  }
});

test("the guard: a list with a harmless name but a live path is refused", async () => {
  await withSync(
    async (ctx) => {
      const answered = ctx.service.enqueue(USER_ID, make(ctx));
      assert.equal(answered.sync, "error");
      assert.deepEqual(ctx.fake.requests, []);
    },
    {
      env: { ...fakeEnv({ base: "http://127.0.0.1:1" } as FakeCalDav), BUJO_CALDAV_LISTS: `scratch=${LIST_PATHS.Aufgaben},Aufgaben=${LIST_PATHS.Aufgaben}` },
      sync: { listName: "scratch", live: false },
    },
  );
});

test("the guard: with live sync on, the live list is written (against the fake server only)", async () => {
  await withSync(
    async (ctx) => {
      const answered = ctx.service.enqueue(USER_ID, make(ctx));
      assert.equal(answered.sync, "pending");
      await ctx.service.idle();
      assert.equal(reread(ctx, answered.id).sync, "synced");
      assert.equal(ctx.fake.names(LIST_PATHS.Aufgaben).length, FIXTURE_COUNT + 1);
    },
    { sync: { listName: "Aufgaben", live: true } },
  );
});
const FIXTURE_COUNT = 7;

test("a sync list that is not configured is an error with a clear message, and nothing is sent", async () => {
  await withSync(
    async (ctx) => {
      const answered = ctx.service.enqueue(USER_ID, make(ctx));
      assert.equal(answered.sync, "error");
      assert.equal(answered.syncError, 'The sync list "bujo-test" is not set up.');
      assert.deepEqual(ctx.fake.requests, []);
    },
    { env: fakeEnv({ base: "http://127.0.0.1:1" } as FakeCalDav) },
  );
});

// ----- store, migration, restart -----

test("the remote link is stored in the database and never in the entry the API shows", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    await ctx.service.idle();
    const shown = JSON.stringify(reread(ctx, created.id));
    for (const secret of ["remote", "href", "etag", "uid-1", "user-1", "dav"]) assert.equal(shown.includes(secret), false, secret);
  });
});

test("an old database without the sync columns is migrated on open and keeps its entries", () => {
  const file = `/tmp/opencode/bujo-migrate-${process.pid}-${Date.now()}.db`;
  const old = new DatabaseSync(file);
  old.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, email_verified_at INTEGER, recovery_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, date TEXT NOT NULL, time TEXT,
      type TEXT NOT NULL, title TEXT NOT NULL, tag TEXT, sync TEXT NOT NULL DEFAULT 'local',
      position INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO users VALUES ('u', 'T', NULL, NULL, 'h', 1);
    INSERT INTO entries VALUES ('e1', 'u', '2026-11-20', NULL, 'task', 'Altbestand', NULL, 'local', 0, 1, 1);
  `);
  old.close();
  for (let round = 0; round < 2; round++) {
    const db = openDb(file);
    const entry = createEntryStore(db).get("u", "e1")!;
    assert.equal(entry.title, "Altbestand");
    assert.equal(entry.syncError, null);
    assert.equal(createEntryStore(db).getRemote("u", "e1"), undefined);
    db.close();
  }
});

test("a push cut short by a stop is shown as an error to retry after the next start", async () => {
  await withSync(async (ctx) => {
    const entry = ctx.entries.setSync(USER_ID, make(ctx).id, { sync: "pending" })!;
    failInterrupted(ctx.db);
    const after = reread(ctx, entry.id);
    assert.equal(after.sync, "error");
    assert.match(after.syncError!, /interrupted/);
  });
});

// ----- through the API -----

type ApiCtx = { base: string; headers: { cookie: string }; fake: FakeCalDav; service: SyncService };

/** The app and the sync service on one in-memory db, with the fake server as Nextcloud. */
async function withSyncedApp(fn: (ctx: ApiCtx) => Promise<void>, wire = true): Promise<void> {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  const caldav = loadCalDavConfig(syncEnv(fake))!;
  const service = createSyncService({ db, caldav, sync: { ...SYNC_SETTINGS }, log: () => undefined });
  try {
    await withApp(
      demoSource(),
      async ({ base }) => {
        const signed = await signUp(base);
        await fn({ base, headers: signed.headers, fake, service });
        await service.idle();
      },
      { db, sync: wire ? service : undefined },
    );
  } finally {
    await fake.close();
  }
}

const post = (ctx: ApiCtx, body: object) => api(ctx.base, "POST", "/api/entries", { body, headers: ctx.headers });

test("API: a task answers pending at once, a note stays local, and the list ends up synced", async () => {
  await withSyncedApp(async (ctx) => {
    const task = await post(ctx, { date: "2026-11-24", type: "task", title: UMLAUT });
    assert.equal(task.status, 201);
    assert.equal(task.json.entry.sync, "pending");
    assert.equal(task.json.entry.syncError, null);
    assert.equal((await post(ctx, { date: "2026-11-24", type: "note", title: "nur lokal" })).json.entry.sync, "local");
    await ctx.service.idle();
    const list = await api(ctx.base, "GET", "/api/entries?from=2026-11-24&to=2026-11-24", { headers: ctx.headers });
    assert.deepEqual(list.json.entries.map((e: Entry) => [e.type, e.sync]), [["task", "synced"], ["note", "local"]]);
    const shown = JSON.stringify(list.json);
    for (const secret of ["remote", "href", "etag", "uid-"]) assert.equal(shown.includes(secret), false, secret);
    assert.equal(ctx.fake.names(BOX).length, 1);
  });
});

test("API: a PATCH of title, type or day pushes again, a PATCH of the tag does not", async () => {
  await withSyncedApp(async (ctx) => {
    const id = (await post(ctx, { date: "2026-11-24", type: "task", title: "alt" })).json.entry.id as string;
    await ctx.service.idle();
    const patch = (body: object) => api(ctx.base, "PATCH", `/api/entries/${id}`, { body, headers: ctx.headers });
    const before = puts(ctx.fake).length;

    const tagged = await patch({ tag: "Haushalt" });
    assert.equal(tagged.json.entry.sync, "synced");
    await ctx.service.idle();
    assert.equal(puts(ctx.fake).length, before);

    const retitled = await patch({ title: "neu" });
    assert.equal(retitled.json.entry.sync, "pending");
    await ctx.service.idle();
    assert.equal(puts(ctx.fake).length, before + 1);
  });
});

test("API: retry answers 404 for an unknown entry and 409 when the entry did not fail", async () => {
  await withSyncedApp(async (ctx) => {
    const retry = (id: string) => api(ctx.base, "POST", `/api/entries/${id}/sync`, { headers: ctx.headers });
    assert.equal((await retry("nope")).status, 404);
    const id = (await post(ctx, { date: "2026-11-24", type: "task", title: "ok" })).json.entry.id as string;
    await ctx.service.idle();
    assert.equal((await retry(id)).status, 409);
    const note = (await post(ctx, { date: "2026-11-24", type: "note", title: "n" })).json.entry.id as string;
    assert.equal((await retry(note)).status, 409);
  });
});

test("API: retry on a failed entry answers pending, then the push goes through", async () => {
  await withSyncedApp(async (ctx) => {
    ctx.fake.switches.conflictOnPut = true;
    const id = (await post(ctx, { date: "2026-11-24", type: "task", title: "zäh" })).json.entry.id as string;
    await ctx.service.idle();
    const failed = await api(ctx.base, "GET", "/api/entries?from=2026-11-24&to=2026-11-24", { headers: ctx.headers });
    assert.equal(failed.json.entries[0].sync, "error");
    assert.ok(failed.json.entries[0].syncError);

    ctx.fake.switches.conflictOnPut = false;
    const retried = await api(ctx.base, "POST", `/api/entries/${id}/sync`, { headers: ctx.headers });
    assert.equal(retried.status, 200);
    assert.equal(retried.json.entry.sync, "pending");
    await ctx.service.idle();
    const done = await api(ctx.base, "GET", "/api/entries?from=2026-11-24&to=2026-11-24", { headers: ctx.headers });
    assert.equal(done.json.entries[0].sync, "synced");
    assert.equal(done.json.entries[0].syncError, null);
  });
});

test("API: retry needs a session", async () => {
  await withSyncedApp(async (ctx) => {
    assert.equal((await api(ctx.base, "POST", "/api/entries/x/sync")).status, 401);
  });
});

test("API: without a sync service every entry stays local and retry answers 503", async () => {
  await withSyncedApp(async (ctx) => {
    const created = await post(ctx, { date: "2026-11-24", type: "task", title: "lokal" });
    assert.equal(created.json.entry.sync, "local");
    assert.equal((await api(ctx.base, "POST", `/api/entries/${created.json.entry.id}/sync`, { headers: ctx.headers })).status, 503);
    assert.deepEqual(ctx.fake.requests, []);
  }, false);
});

test("API: moving, indenting and outdenting an entry write nothing to Nextcloud", async () => {
  await withSyncedApp(async (ctx) => {
    const first = (await post(ctx, { date: "2026-11-24", type: "task", title: "eins" })).json.entry.id as string;
    const second = (await post(ctx, { date: "2026-11-24", type: "task", title: "zwei" })).json.entry.id as string;
    await ctx.service.idle();
    const before = ctx.fake.requests.length;

    const patch = (id: string, body: object) => api(ctx.base, "PATCH", `/api/entries/${id}`, { body, headers: ctx.headers });
    const indented = await patch(second, { indent: 1 });
    assert.equal(indented.json.entry.indent, 1);
    assert.equal(indented.json.entry.sync, "synced");
    assert.equal((await patch(second, { indent: 0 })).json.entry.sync, "synced");
    const moved = await api(ctx.base, "POST", `/api/entries/${first}/move`, { body: { direction: "down" }, headers: ctx.headers });
    assert.equal(moved.status, 200);
    await ctx.service.idle();
    assert.equal(ctx.fake.requests.length, before, "no request reached the fake server");
  });
});

test("API: deleting a synced entry removes the local row only and never sends a DELETE", async () => {
  await withSyncedApp(async (ctx) => {
    const id = (await post(ctx, { date: "2026-11-24", type: "task", title: UMLAUT })).json.entry.id as string;
    await ctx.service.idle();
    const before = ctx.fake.requests.length;
    const removed = await api(ctx.base, "DELETE", `/api/entries/${id}`, { headers: ctx.headers });
    assert.equal(removed.status, 200);
    await ctx.service.idle();
    assert.equal(ctx.fake.requests.length, before);
    assert.equal(ctx.fake.requests.some((request) => request.method === "DELETE"), false);
    assert.equal(ctx.fake.names(BOX).length, 1, "the VTODO stays on the server");
  });
});
