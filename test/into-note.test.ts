import assert from "node:assert/strict";
import test from "node:test";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { demoSource } from "../src/caldav/source.ts";
import { openDb } from "../src/db.ts";
import { appendLine } from "../src/log/into-note.ts";
import { BODY_MAX } from "../src/log/validation.ts";
import { createSyncService, type SyncService } from "../src/sync/service.ts";
import { LIST_PATHS, startFakeCalDav, SYNC_SETTINGS, syncEnv, type FakeCalDav } from "./fake-caldav.ts";
import { api, signUp, withApp } from "./helpers.ts";

const DAY = "2026-11-24";
const BOX = LIST_PATHS["bujo-test"];

type Ctx = { base: string; headers: { cookie: string }; fake: FakeCalDav; service: SyncService };

/** The app and the sync service on one in-memory db, with the fake server as Nextcloud (the bujo-test list only). */
async function withSyncedApp(fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  const service = createSyncService({ db, caldav: loadCalDavConfig(syncEnv(fake))!, sync: { ...SYNC_SETTINGS }, log: () => undefined });
  try {
    await withApp(demoSource(), async ({ base }) => {
      const signed = await signUp(base);
      await fn({ base, headers: signed.headers, fake, service });
      await service.idle();
    }, { db, sync: service });
  } finally {
    await fake.close();
  }
}

const post = (ctx: Pick<Ctx, "base" | "headers">, body: object) => api(ctx.base, "POST", "/api/entries", { body: { date: DAY, ...body }, headers: ctx.headers });
const fileInto = (ctx: Pick<Ctx, "base" | "headers">, id: string, noteId: unknown) => api(ctx.base, "POST", `/api/entries/${id}/into-note`, { body: { noteId }, headers: ctx.headers });
const notes = async (ctx: Pick<Ctx, "base" | "headers">) => (await api(ctx.base, "GET", "/api/entries?kind=notes", { headers: ctx.headers })).json.entries;
const day = async (ctx: Pick<Ctx, "base" | "headers">) => (await api(ctx.base, "GET", `/api/entries?from=${DAY}&to=${DAY}`, { headers: ctx.headers })).json.entries;

test("appendLine: a new last line, a bullet only when the note is a list, never a link", () => {
  assert.equal(appendLine("# Ideas\nsome text", "Call Anna"), "# Ideas\nsome text\nCall Anna\n");
  assert.equal(appendLine("# Ideas\nsome text\n", "Call Anna"), "# Ideas\nsome text\nCall Anna\n");
  assert.equal(appendLine("- one\n- two", "Call Anna"), "- one\n- two\n- Call Anna\n");
  assert.equal(appendLine("1. one", "Call Anna"), "1. one\nCall Anna\n");
});

test("a task is filed into a free-form note as a line, and leaves the log", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const ctx = { base, headers: (await signUp(base)).headers };
    const note = (await post(ctx, { type: "note", title: "Ideas", body: "- first" })).json.entry;
    const task = (await post(ctx, { type: "task", title: "Buy stamps", tags: ["errand"] })).json.entry;
    await post(ctx, { type: "task", title: "Stay here" });

    const filed = await fileInto(ctx, task.id, note.id);
    assert.equal(filed.status, 200, JSON.stringify(filed.json));
    assert.equal(filed.json.note.body, "- first\n- Buy stamps\n");
    assert.deepEqual(filed.json.entries.map((e: { title: string }) => e.title), ["Stay here"]);
    assert.deepEqual((await day(ctx)).map((e: { title: string }) => e.title), ["Stay here"]);
    assert.equal((await notes(ctx))[0].body, "- first\n- Buy stamps\n");
    assert.ok(!JSON.stringify(await notes(ctx)).includes(task.id), "no pointer to the old entry");
    assert.equal((await fileInto(ctx, task.id, note.id)).status, 404, "the task is gone");
  });
});

test("a task filed on a collection page is filed into a note too", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const ctx = { base, headers: (await signUp(base)).headers };
    const collection = (await api(base, "POST", "/api/collections", { body: { name: "Books" }, headers: ctx.headers })).json.collection;
    const note = (await post(ctx, { type: "note", title: "Ideas", body: "plain text" })).json.entry;
    const task = (await post(ctx, { type: "task", title: "Read Dune", collectionId: collection.id })).json.entry;
    assert.equal((await fileInto(ctx, task.id, note.id)).status, 200);
    const page = await api(base, "GET", `/api/entries?collection=${collection.id}`, { headers: ctx.headers });
    assert.deepEqual(page.json.entries, []);
    assert.equal((await notes(ctx))[0].body, "plain text\nRead Dune\n");
  });
});

test("filing is refused cleanly: a missing note, a dash note, an event, a note as the task, a body over BODY_MAX", async () => {
  await withApp(demoSource(), async ({ base }) => {
    const ctx = { base, headers: (await signUp(base)).headers };
    const task = (await post(ctx, { type: "task", title: "Buy stamps" })).json.entry;
    const dash = (await post(ctx, { type: "note", title: "short dash note" })).json.entry;
    const event = (await post(ctx, { type: "event", title: "Dentist", time: "09:00" })).json.entry;
    const note = (await post(ctx, { type: "note", title: "Ideas", body: "text" })).json.entry;
    const full = (await post(ctx, { type: "note", title: "Full", body: "x".repeat(BODY_MAX - 3) })).json.entry;

    assert.equal((await fileInto(ctx, task.id, "00000000-0000-4000-8000-000000000000")).status, 404);
    assert.equal((await fileInto(ctx, task.id, dash.id)).status, 400);
    assert.equal((await fileInto(ctx, task.id, full.id)).status, 400);
    assert.equal((await fileInto(ctx, task.id, 5)).status, 400);
    assert.equal((await fileInto(ctx, event.id, note.id)).status, 400);
    assert.equal((await fileInto(ctx, note.id, full.id)).status, 400);
    assert.equal((await fileInto(ctx, "nope", note.id)).status, 404);
    assert.equal((await api(base, "GET", `/api/entries/${task.id}/into-note`, { headers: ctx.headers })).status, 405);
    assert.equal((await api(base, "POST", `/api/entries/${task.id}/into-note`, { body: { noteId: note.id } })).status, 401);

    assert.equal((await notes(ctx)).find((e: { id: string }) => e.id === note.id).body, "text", "nothing was written");
    assert.deepEqual((await day(ctx)).map((e: { title: string }) => e.title).sort(), ["Buy stamps", "Dentist", "short dash note"]);
  });
});

test("CalDAV: a synced task is pushed as CANCELLED before it leaves, and its VTODO is never deleted", async () => {
  await withSyncedApp(async (ctx) => {
    const note = (await post(ctx, { type: "note", title: "Ideas", body: "text" })).json.entry;
    const task = (await post(ctx, { type: "task", title: "Buy stamps" })).json.entry;
    await ctx.service.idle();
    assert.deepEqual(ctx.fake.names(BOX).length, 1);
    assert.ok(ctx.fake.read(BOX, ctx.fake.names(BOX)[0])!.includes("STATUS:NEEDS-ACTION"));

    assert.equal((await fileInto(ctx, task.id, note.id)).status, 200);
    assert.equal(ctx.fake.names(BOX).length, 1, "the VTODO stays on the server");
    assert.ok(ctx.fake.read(BOX, ctx.fake.names(BOX)[0])!.includes("STATUS:CANCELLED"));
    assert.equal(ctx.fake.requests.some((request) => request.method === "DELETE"), false);
    assert.ok(!(await day(ctx)).some((e: { id: string }) => e.id === task.id));
  });
});

test("CalDAV: a done task keeps its COMPLETED VTODO and is not pushed again", async () => {
  await withSyncedApp(async (ctx) => {
    const note = (await post(ctx, { type: "note", title: "Ideas", body: "text" })).json.entry;
    const task = (await post(ctx, { type: "done", title: "Paid rent" })).json.entry;
    await ctx.service.idle();
    const name = ctx.fake.names(BOX)[0];
    assert.ok(ctx.fake.read(BOX, name)!.includes("STATUS:COMPLETED"));
    const puts = () => ctx.fake.requests.filter((request) => request.method === "PUT").length;
    const before = puts();
    assert.equal((await fileInto(ctx, task.id, note.id)).status, 200);
    assert.equal(puts(), before);
    assert.ok(ctx.fake.read(BOX, name)!.includes("STATUS:COMPLETED"));
    assert.equal(ctx.fake.requests.some((request) => request.method === "DELETE"), false);
  });
});

test("CalDAV: when the cancel push fails, nothing is filed and the task is still on the log", async () => {
  await withSyncedApp(async (ctx) => {
    const note = (await post(ctx, { type: "note", title: "Ideas", body: "text" })).json.entry;
    const task = (await post(ctx, { type: "task", title: "Buy stamps" })).json.entry;
    await ctx.service.idle();
    ctx.fake.switches.conflictOnPut = true;
    const filed = await fileInto(ctx, task.id, note.id);
    assert.equal(filed.status, 502);
    assert.equal((await notes(ctx))[0].body, "text");
    assert.ok((await day(ctx)).some((e: { id: string }) => e.id === task.id));
  });
});
