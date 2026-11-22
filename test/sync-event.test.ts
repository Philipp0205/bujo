import assert from "node:assert/strict";
import test from "node:test";
import { CalDavClient } from "../src/caldav/client.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { openDb, type Db } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import type { Entry, NewEntry } from "../src/log/types.ts";
import { loadSyncConfig, type SyncConfig } from "../src/sync/config.ts";
import { eventWriteRefusal } from "../src/sync/guard.ts";
import { createSyncService, touchesMapping, type SyncService } from "../src/sync/service.ts";
import { eventsStartupText } from "../src/sync/startup.ts";
import { EVENT_CALENDAR, LIST_PATHS, PASSWORD, startFakeCalDav, SYNC_SETTINGS, syncEnv, USER, type FakeCalDav } from "./fake-caldav.ts";

const NOW = Date.parse("2026-11-20T10:00:00Z");
const CAL = LIST_PATHS["bujo-test-cal"];
const BOX = LIST_PATHS["bujo-test"];
const USER_ID = "user-1";
const TITLE = "Zahnarzt Müller für Übergabe";

type Ctx = { fake: FakeCalDav; service: SyncService; entries: ReturnType<typeof createEntryStore>; logs: string[]; db: Db };

/** The sync service over an in-memory db and the fake server. Nothing here reaches a real calendar. */
async function withSync(
  fn: (ctx: Ctx) => Promise<void>,
  options: { env?: NodeJS.ProcessEnv; sync?: SyncConfig; client?: (fake: FakeCalDav) => CalDavClient } = {},
): Promise<void> {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, 'T', 'h', 1)").run(USER_ID);
  try {
    let n = 0;
    const logs: string[] = [];
    const service = createSyncService({
      db,
      caldav: loadCalDavConfig(options.env ?? syncEnv(fake))!,
      sync: options.sync ?? { ...SYNC_SETTINGS },
      client: options.client?.(fake),
      now: () => NOW,
      uuid: () => `uid-${++n}`,
      log: (message) => logs.push(message),
    });
    await fn({ fake, service, entries: createEntryStore(db), logs, db });
  } finally {
    db.close();
    await fake.close();
  }
}

const NEW: NewEntry = { date: "2026-11-24", type: "event", title: TITLE, tags: [], time: null };
const make = (ctx: Ctx, patch: Partial<NewEntry> = {}): Entry => ctx.entries.create(USER_ID, { ...NEW, ...patch }, NOW);
const puts = (fake: FakeCalDav) => fake.requests.filter((request) => request.method === "PUT");
const reread = (ctx: Ctx, id: string) => ctx.entries.get(USER_ID, id)!;
const unfolded = (text: string) => text.replace(/\r\n /g, "");
const eventText = (fake: FakeCalDav, uid = "uid-1") => unfolded(fake.read(CAL, `${uid}.ics`)!);

async function pushAndWait(ctx: Ctx, entry: Entry): Promise<Entry> {
  ctx.service.enqueue(USER_ID, entry);
  await ctx.service.idle();
  return reread(ctx, entry.id);
}

// ----- create and update -----

test("create: an all-day event is a PUT with If-None-Match: * into the event calendar, read back, synced", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
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
    assert.equal(put.url, `${CAL}uid-1.ics`);
    assert.equal(ctx.fake.requests.at(-1)!.method, "GET", "the last request is the read-back");
    assert.deepEqual(ctx.fake.names(CAL), ["uid-1.ics"]);
    assert.deepEqual(ctx.fake.names(BOX), [], "no VTODO is made for an event");

    const ics = eventText(ctx.fake);
    assert.ok(ics.includes("BEGIN:VEVENT") && !ics.includes("BEGIN:VTODO"));
    assert.ok(ics.includes("UID:uid-1"));
    assert.ok(ics.includes(`X-BUJO-ID:${created.id}`));
    assert.ok(ics.includes(`SUMMARY:${TITLE}`));
    assert.ok(ics.includes("DTSTART;VALUE=DATE:20261124"));
    assert.ok(ics.includes("DTEND;VALUE=DATE:20261125"));
    assert.ok(ics.includes("TRANSP:TRANSPARENT"));
    assert.ok(ics.includes("CATEGORIES:bujo"));
    for (const name of ["ATTENDEE", "ORGANIZER", "DESCRIPTION"]) assert.equal(ics.includes(name), false, name);
    assert.deepEqual(ctx.entries.getRemote(USER_ID, created.id), { href: `${ctx.fake.base}${CAL}uid-1.ics`, uid: "uid-1", etag: '"etag-v1"' });
  });
});

test("create: a timed event with a tag is written in Europe/Berlin with an explicit end and both categories", async () => {
  await withSync(async (ctx) => {
    const synced = await pushAndWait(ctx, make(ctx, { time: "13:00", tags: ["Arzt"] }));
    assert.equal(synced.sync, "synced");
    const ics = eventText(ctx.fake);
    assert.ok(ics.includes("DTSTART;TZID=Europe/Berlin:20261124T130000"));
    assert.ok(ics.includes("DTEND;TZID=Europe/Berlin:20261124T140000"));
    assert.ok(ics.includes("BEGIN:VTIMEZONE") && ics.includes("TZID:Europe/Berlin"));
    assert.ok(ics.includes("CATEGORIES:bujo,Arzt"));
    assert.equal(ics.includes("TRANSP"), false);
    assert.equal(ics.includes("DURATION"), false);
  });
});

test("update: a time, tag and title change is a GET, a PUT with If-Match, a read-back; foreign properties stay", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    await pushAndWait(ctx, created);
    ctx.fake.touch(CAL, "uid-1.ics", ctx.fake.read(CAL, "uid-1.ics")!.replace("END:VEVENT", "LOCATION:Praxis\r\nX-OTHER:keep me\r\nEND:VEVENT"));
    const before = ctx.fake.requests.length;

    const edited = ctx.entries.update(USER_ID, created.id, { title: "Zahnarzt Kontrolle", time: "09:30", tags: ["Arzt"] }, NOW)!;
    assert.equal(ctx.service.enqueue(USER_ID, edited).sync, "pending");
    await ctx.service.idle();

    assert.equal(reread(ctx, created.id).sync, "synced");
    assert.equal(ctx.fake.requests.slice(before).map((r) => r.method).join(), "GET,PUT,GET");
    const [, update] = puts(ctx.fake);
    assert.match(update.ifMatch!, /^"etag-v\d+"$/);
    assert.equal(update.ifNoneMatch, undefined);
    const ics = eventText(ctx.fake);
    assert.ok(ics.includes("SUMMARY:Zahnarzt Kontrolle"));
    assert.ok(ics.includes("DTSTART;TZID=Europe/Berlin:20261124T093000"));
    assert.ok(ics.includes("CATEGORIES:bujo,Arzt"));
    assert.ok(ics.includes("LOCATION:Praxis") && ics.includes("X-OTHER:keep me"));
    assert.deepEqual(ctx.fake.names(CAL), ["uid-1.ics"]);
  });
});

test("German umlauts in the title and the tag arrive intact", async () => {
  await withSync(async (ctx) => {
    await pushAndWait(ctx, make(ctx, { title: "Übergabe für Schlüssel, Größe; Ärger", tags: ["Größe"] }));
    const ics = eventText(ctx.fake);
    assert.ok(ics.includes("SUMMARY:Übergabe für Schlüssel\\, Größe\\; Ärger"));
    assert.ok(ics.includes("CATEGORIES:bujo,Größe"));
  });
});

test("several tags are several categories in the order kept, and removing them all leaves bujo", async () => {
  await withSync(async (ctx) => {
    const created = await pushAndWait(ctx, make(ctx, { tags: ["Arzt", "Größe", "a,b;c"] }));
    assert.ok(eventText(ctx.fake).includes("CATEGORIES:bujo,Arzt,Größe,a\\,b\\;c"));

    const reordered = ctx.entries.update(USER_ID, created.id, { tags: ["Größe", "Arzt"] }, NOW)!;
    await pushAndWait(ctx, reordered);
    assert.ok(eventText(ctx.fake).includes("CATEGORIES:bujo,Größe,Arzt"));

    const cleared = ctx.entries.update(USER_ID, created.id, { tags: [] }, NOW)!;
    await pushAndWait(ctx, cleared);
    assert.ok(eventText(ctx.fake).includes("CATEGORIES:bujo\r\n"));
  });
});

// ----- lookup, foreign objects -----

test("lookup: an event bujo already wrote (X-BUJO-ID) is updated, not created again, when the link was lost", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    await pushAndWait(ctx, created);
    ctx.db.prepare("UPDATE entries SET remote_href = NULL, remote_uid = NULL, remote_etag = NULL").run();
    assert.equal(ctx.entries.getRemote(USER_ID, created.id), undefined);

    const edited = ctx.entries.update(USER_ID, created.id, { title: "neu benannt" }, NOW)!;
    const synced = await pushAndWait(ctx, edited);
    assert.equal(synced.sync, "synced");
    assert.deepEqual(ctx.fake.names(CAL), ["uid-1.ics"], "no second object");
    assert.ok(eventText(ctx.fake).includes("SUMMARY:neu benannt"));
    assert.equal(puts(ctx.fake).at(-1)!.ifMatch !== undefined, true);
  });
});

test("a foreign VEVENT without X-BUJO-ID is never matched, edited or removed", async () => {
  await withSync(async (ctx) => {
    const foreign = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:fremd", "SUMMARY:Fremd", "DTSTART;VALUE=DATE:20261124", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    ctx.fake.seed(CAL, "fremd.ics", foreign);
    await pushAndWait(ctx, make(ctx, { title: "Fremd" }));
    assert.equal(ctx.fake.read(CAL, "fremd.ics"), foreign);
    assert.deepEqual(ctx.fake.names(CAL).sort(), ["fremd.ics", "uid-1.ics"]);
  });
});

test("a stored link that points at a VEVENT without our X-BUJO-ID is refused and the object is left alone", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    await pushAndWait(ctx, created);
    const stripped = ctx.fake.read(CAL, "uid-1.ics")!.replace(/X-BUJO-ID:.*\r\n/, "");
    ctx.fake.touch(CAL, "uid-1.ics", stripped);
    const failed = await pushAndWait(ctx, ctx.entries.update(USER_ID, created.id, { title: "anders" }, NOW)!);
    assert.equal(failed.sync, "error");
    assert.match(failed.syncError!, /not made by bujo/);
    assert.equal(ctx.fake.read(CAL, "uid-1.ics"), stripped);
    assert.equal(puts(ctx.fake).length, 1, "only the first create");
  });
});

// ----- failures -----

test("a 412 on update is a conflict error that names the event, with no overwrite", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    await pushAndWait(ctx, created);
    const before = ctx.fake.read(CAL, "uid-1.ics");
    ctx.fake.switches.conflictOnPut = true;
    const failed = await pushAndWait(ctx, ctx.entries.update(USER_ID, created.id, { title: "anders" }, NOW)!);
    assert.equal(failed.sync, "error");
    assert.match(failed.syncError!, /changed this event at the same moment/);
    assert.equal(ctx.fake.read(CAL, "uid-1.ics"), before);
    assert.equal(puts(ctx.fake).length, 2);
  });
});

test("a read-back that differs is an error, and the retry updates the same event instead of creating another", async () => {
  await withSync(async (ctx) => {
    ctx.fake.switches.corruptReadBack = true;
    const failed = await pushAndWait(ctx, make(ctx));
    assert.equal(failed.sync, "error");
    assert.match(failed.syncError!, /did not keep what was sent/);
    assert.equal(ctx.entries.getRemote(USER_ID, failed.id)?.uid, "uid-1", "the link is kept");

    ctx.fake.switches.corruptReadBack = false;
    const retried = await pushAndWait(ctx, failed);
    assert.equal(retried.sync, "synced");
    assert.equal(retried.syncError, null);
    assert.deepEqual(ctx.fake.names(CAL), ["uid-1.ics"]);
  });
});

test("a read-back with a changed start is a mismatch too", async () => {
  let move = false;
  await withSync(
    async (ctx) => {
      const created = make(ctx);
      await pushAndWait(ctx, created);
      move = true;
      const failed = await pushAndWait(ctx, ctx.entries.update(USER_ID, created.id, { title: "anders" }, NOW)!);
      assert.equal(failed.sync, "error");
      assert.match(failed.syncError!, /did not keep what was sent/);
      assert.ok(ctx.entries.getRemote(USER_ID, created.id), "the link is kept");
    },
    {
      client: (fake) =>
        new CalDavClient({
          base: fake.base,
          user: USER,
          password: PASSWORD,
          fetch: async (input, init) => {
            const response = await fetch(input, init);
            if (move && init?.method === "PUT") {
              fake.touch(CAL, "uid-1.ics", fake.read(CAL, "uid-1.ics")!.replace("DTSTART;VALUE=DATE:20261124", "DTSTART;VALUE=DATE:20261201"));
            }
            return response;
          },
        }),
    },
  );
});

test("no request is ever a DELETE, across create, edit, conflict and retry", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    await pushAndWait(ctx, created);
    await pushAndWait(ctx, ctx.entries.update(USER_ID, created.id, { time: "10:00" }, NOW)!);
    ctx.fake.switches.conflictOnPut = true;
    await pushAndWait(ctx, ctx.entries.update(USER_ID, created.id, { title: "x" }, NOW)!);
    ctx.fake.switches.conflictOnPut = false;
    await pushAndWait(ctx, reread(ctx, created.id));
    const methods = new Set(ctx.fake.requests.map((request) => request.method));
    assert.equal(methods.has("DELETE"), false);
    assert.equal(methods.has("MKCOL") || methods.has("PROPPATCH"), false);
  });
});

// ----- types change -----

test("a note never syncs, and an event that becomes a note goes local and writes nothing", async () => {
  await withSync(async (ctx) => {
    assert.equal(ctx.service.enqueue(USER_ID, make(ctx, { type: "note", title: "nur lokal" })).sync, "local");
    const created = make(ctx);
    await pushAndWait(ctx, created);
    const before = ctx.fake.requests.length;
    const moved = ctx.service.enqueue(USER_ID, ctx.entries.update(USER_ID, created.id, { type: "note" }, NOW)!);
    await ctx.service.idle();
    assert.equal(moved.sync, "local");
    assert.equal(ctx.fake.requests.length, before);
  });
});

test("a note that becomes an event is created in the event calendar", async () => {
  await withSync(async (ctx) => {
    const note = make(ctx, { type: "note" });
    ctx.service.enqueue(USER_ID, note);
    const synced = await pushAndWait(ctx, ctx.entries.update(USER_ID, note.id, { type: "event" }, NOW)!);
    assert.equal(synced.sync, "synced");
    assert.deepEqual(ctx.fake.names(CAL), ["uid-1.ics"]);
  });
});

test("task to event and back: each kind goes to its own collection and no href is reused", async () => {
  await withSync(async (ctx) => {
    const task = make(ctx, { type: "task" });
    await pushAndWait(ctx, task);
    assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"]);

    await pushAndWait(ctx, ctx.entries.update(USER_ID, task.id, { type: "event" }, NOW)!);
    assert.deepEqual(ctx.fake.names(CAL), ["uid-2.ics"], "a new VEVENT, not the VTODO href");
    assert.ok(ctx.fake.read(BOX, "uid-1.ics")!.includes("BEGIN:VTODO"), "the old VTODO stays");
    assert.ok(!ctx.fake.read(CAL, "uid-2.ics")!.includes("VTODO"));

    await pushAndWait(ctx, ctx.entries.update(USER_ID, task.id, { type: "task" }, NOW)!);
    assert.ok(ctx.fake.read(CAL, "uid-2.ics")!.includes("BEGIN:VEVENT"), "the VEVENT is not turned into a VTODO");
    assert.equal(ctx.fake.names(CAL).length, 1);
    assert.equal(reread(ctx, task.id).sync, "synced");
    assert.equal(ctx.fake.requests.some((r) => r.method === "DELETE"), false);
  });
});

test("the target follows the type at run time: a queued event that becomes a task is pushed as a task", async () => {
  await withSync(async (ctx) => {
    const created = make(ctx);
    ctx.service.enqueue(USER_ID, created);
    ctx.entries.update(USER_ID, created.id, { type: "task" }, NOW);
    await ctx.service.idle();
    assert.deepEqual(ctx.fake.names(CAL), []);
    assert.deepEqual(ctx.fake.names(BOX), ["uid-1.ics"]);
  });
});

// ----- the guard -----

test("the guard: any event calendar other than bujo-test-cal is refused with nothing sent, even with live sync", async () => {
  const refused: Array<[string, string]> = [
    ["personal", "/dav/calendars/test/personal/"],
    ["work", "/dav/calendars/test/work/"],
    ["bujo-test", BOX],
    ["Aufgaben", LIST_PATHS.Aufgaben],
    ["bujo-test-cal", "/dav/calendars/test/personal/"],
    ["bujo-test-cal", "/dav/calendars/test/bujo-test-cal-2/"],
    ["bujo-test-cal", "/dav/calendars/test/work/bujo-test-cal/"],
    ["bujo-test-cal", "/dav/calendars/test/bujo-test-cal/?x=1"],
    ["bujo-test-cal", "/dav/calendars/test/other%2Fbujo-test-cal/"],
    ["personal", CAL],
  ];
  for (const live of [false, true]) {
    for (const [name, path] of refused) {
      await withSync(
        async (ctx) => {
          const answered = ctx.service.enqueue(USER_ID, make(ctx));
          assert.equal(answered.sync, "error", `${name} ${path} live=${live}`);
          assert.match(answered.syncError!, /only written to the test calendar "bujo-test-cal"/);
          await ctx.service.idle();
          assert.deepEqual(ctx.fake.requests, [], `${path} was reached`);
        },
        { sync: { listName: "bujo-test", live, eventCalendar: { name, path } } },
      );
    }
  }
});

test("the guard: a calendar that shares a path with a configured task list is refused", () => {
  const lists = [{ name: "scratch", path: CAL }];
  assert.notEqual(eventWriteRefusal(EVENT_CALENDAR, lists), null);
  assert.equal(eventWriteRefusal(EVENT_CALENDAR, [{ name: "bujo-test", path: BOX }]), null);
  assert.notEqual(eventWriteRefusal(null, []), null);
});

test("with no event calendar set, an event is a plain error and nothing is sent; a task still syncs", async () => {
  await withSync(
    async (ctx) => {
      const answered = ctx.service.enqueue(USER_ID, make(ctx));
      assert.equal(answered.sync, "error");
      assert.equal(answered.syncError, "The event calendar is not set up.");
      assert.deepEqual(ctx.fake.requests, []);
      assert.equal((await pushAndWait(ctx, make(ctx, { type: "task" }))).sync, "synced");
      assert.deepEqual(ctx.fake.names(CAL), []);
    },
    { sync: { listName: "bujo-test", live: false, eventCalendar: null } },
  );
});

test("an event calendar given in BUJO_CALDAV_LISTS as well is not a task list for events either", async () => {
  await withSync(
    async (ctx) => {
      const answered = ctx.service.enqueue(USER_ID, make(ctx));
      assert.equal(answered.sync, "error");
      assert.deepEqual(ctx.fake.requests, []);
    },
    { env: { ...syncEnv({ base: "http://127.0.0.1:1" } as FakeCalDav), BUJO_CALDAV_LISTS: `bujo-test=${BOX},viaLists=${CAL}` } },
  );
});

// ----- config, startup, mapping rule -----

test("config: BUJO_CALDAV_EVENT_CALENDAR is one name=path pair, and BUJO_LIVE_SYNC does not change it", () => {
  assert.deepEqual(loadSyncConfig({ BUJO_CALDAV_EVENT_CALENDAR: `bujo-test-cal=${CAL}` }).eventCalendar, EVENT_CALENDAR);
  assert.equal(loadSyncConfig({}).eventCalendar, null);
  assert.equal(loadSyncConfig({ BUJO_CALDAV_EVENT_CALENDAR: "bujo-test-cal" }).eventCalendar, null);
  assert.equal(loadSyncConfig({ BUJO_CALDAV_EVENT_CALENDAR: "=x" }).eventCalendar, null);
  const live = loadSyncConfig({ BUJO_LIVE_SYNC: "1", BUJO_CALDAV_EVENT_CALENDAR: "personal=/dav/calendars/test/personal/" });
  assert.notEqual(eventWriteRefusal(live.eventCalendar, []), null);
});

test("the startup line names the calendar and never a path, URL or credential", () => {
  const caldav = loadCalDavConfig(syncEnv({ base: "http://127.0.0.1:9" } as FakeCalDav))!;
  const on = eventsStartupText(caldav, { ...SYNC_SETTINGS });
  assert.equal(on, 'calendar "bujo-test-cal"');
  assert.match(eventsStartupText(caldav, { listName: "bujo-test", live: false, eventCalendar: null }), /^off/);
  const bad = eventsStartupText(caldav, { listName: "bujo-test", live: true, eventCalendar: { name: "personal", path: "/dav/calendars/test/personal/" } });
  assert.match(bad, /refused/);
  assert.match(eventsStartupText(null, { ...SYNC_SETTINGS }), /^off/);
  for (const text of [on, bad]) assert.equal(/\/dav|http|password|tester/i.test(text), false, text);
});

test("an edit is pushed for an event on time or tag, and for a task only on title, type or date", () => {
  assert.equal(touchesMapping({ time: "10:00" }, { type: "event" }), true);
  assert.equal(touchesMapping({ tags: ["x"] }, { type: "event" }), true);
  assert.equal(touchesMapping({ tags: [] }, { type: "event" }), true);
  assert.equal(touchesMapping({ time: "10:00" }, { type: "task" }), false);
  assert.equal(touchesMapping({ tags: ["x"] }, { type: "task" }), false);
  assert.equal(touchesMapping({ horizon: "future" }, { type: "task" }), true, "the horizon decides the DUE");
  for (const type of ["task", "event"] as const) {
    for (const patch of [{ title: "t" }, { type: "note" as const }, { date: "2026-12-01" }]) assert.equal(touchesMapping(patch, { type }), true);
  }
});

// ----- the fake server tells the two kinds apart -----

test("PROPFIND reports VEVENT for the event calendar and VTODO for a task list", async () => {
  const fake = await startFakeCalDav();
  try {
    const auth = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;
    const ask = async (path: string) => (await fetch(`${fake.base}${path}`, { method: "PROPFIND", headers: { authorization: auth, depth: "0" } })).text();
    assert.match(await ask(CAL), /comp name="VEVENT"/);
    assert.match(await ask(BOX), /comp name="VTODO"/);
    assert.equal((await ask(CAL)).includes("VTODO"), false);
  } finally {
    await fake.close();
  }
});
