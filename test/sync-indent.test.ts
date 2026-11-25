import assert from "node:assert/strict";
import test from "node:test";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { openDb } from "../src/db.ts";
import { createEntryStore } from "../src/log/store.ts";
import type { NewEntry } from "../src/log/types.ts";
import { createSyncService, touchesMapping } from "../src/sync/service.ts";
import { LIST_PATHS, startFakeCalDav, SYNC_SETTINGS, syncEnv, type FakeCalDav } from "./fake-caldav.ts";

// Indent (a child nested under the entry above) is local to bujo on purpose. These tests run an event with notes under it and a task with a
// task under it against the fake CalDAV server, flat and nested, and prove the calendar objects and the requests are the same.

const NOW = Date.parse("2026-11-20T10:00:00Z");
const USER_ID = "user-1";
const BOX = LIST_PATHS["bujo-test"];
const CAL = LIST_PATHS["bujo-test-cal"];
const DAY = "2026-11-24";

const SPEC: Array<{ id: string; type: NewEntry["type"]; title: string }> = [
  { id: "e-meeting", type: "event", title: "Meeting mit Anna" },
  { id: "e-note-1", type: "note", title: "Notiz eins" },
  { id: "e-note-2", type: "note", title: "Notiz zwei" },
  { id: "e-note-3", type: "note", title: "Notiz drei" },
  { id: "e-task", type: "task", title: "Einkauf planen" },
  { id: "e-child", type: "task", title: "Milch kaufen" },
];
const CHILDREN = ["e-note-1", "e-note-2", "e-note-3", "e-child"];

type Run = { events: string[]; todos: string[]; names: { box: string[]; cal: string[] }; methods: string[]; syncs: string[]; fake: FakeCalDav };

const files = (fake: FakeCalDav, path: string): string[] => fake.names(path).map((name) => fake.read(path, name)!.replace(/\r\n /g, ""));

/** Pushes the six entries in page order, flat or with the children nested, and reads back what the server holds. */
async function run(nested: boolean, after?: (ctx: { entries: ReturnType<typeof createEntryStore>; service: ReturnType<typeof createSyncService>; fake: FakeCalDav }) => Promise<void>): Promise<Run> {
  const fake = await startFakeCalDav();
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (id, name, recovery_hash, created_at) VALUES (?, 'T', 'h', 1)").run(USER_ID);
  try {
    let n = 0;
    const service = createSyncService({
      db,
      caldav: loadCalDavConfig(syncEnv(fake))!,
      sync: { ...SYNC_SETTINGS },
      now: () => NOW,
      uuid: () => `uid-${++n}`,
      log: () => undefined,
    });
    const entries = createEntryStore(db);
    for (const spec of SPEC) {
      const created = entries.create(USER_ID, { id: spec.id, date: DAY, type: spec.type, title: spec.title, tags: [], time: null }, NOW);
      if (nested && CHILDREN.includes(spec.id)) entries.update(USER_ID, spec.id, { indent: 1 }, NOW);
      service.enqueue(USER_ID, entries.get(USER_ID, created.id)!);
      await service.idle();
    }
    if (nested) assert.deepEqual(CHILDREN.map((id) => entries.get(USER_ID, id)!.indent), [1, 1, 1, 1]);
    await after?.({ entries, service, fake });
    return {
      events: files(fake, CAL),
      todos: files(fake, BOX),
      names: { box: fake.names(BOX), cal: fake.names(CAL) },
      methods: fake.requests.map((request) => `${request.method} ${request.url}`),
      syncs: SPEC.map((spec) => entries.get(USER_ID, spec.id)!.sync),
      fake,
    };
  } finally {
    db.close();
    await fake.close();
  }
}

test("nested children sync exactly like the flat case: same objects, no RELATED-TO, no DESCRIPTION, notes not pushed", async () => {
  const flat = await run(false);
  const nested = await run(true);
  assert.deepEqual(nested.events, flat.events);
  assert.deepEqual(nested.todos, flat.todos);
  assert.deepEqual(nested.names, flat.names);
  assert.deepEqual(nested.methods, flat.methods);
  assert.deepEqual(nested.syncs, ["synced", "local", "local", "local", "synced", "synced"]);
  assert.equal(nested.names.cal.length, 1, "the meeting is the only event, its notes are not pushed");
  assert.equal(nested.names.box.length, 2, "the task and its child task are two VTODOs");
  for (const text of [...nested.events, ...nested.todos]) {
    assert.ok(!text.includes("RELATED-TO"), "no parent link is written");
    assert.ok(!text.includes("DESCRIPTION"), "no description is written");
    assert.ok(!text.includes("Notiz"), "no note text reaches the calendar");
  }
  assert.ok(nested.events[0].includes("BEGIN:VEVENT") && nested.todos.every((text) => text.includes("BEGIN:VTODO")));
});

test("changing an entry's indent pushes nothing", async () => {
  let before = 0;
  const result = await run(false, async ({ entries, service, fake }) => {
    before = fake.requests.length;
    for (const id of ["e-note-1", "e-child", "e-note-1"]) {
      const current = entries.get(USER_ID, id)!;
      const patch = { indent: current.indent === 1 ? 0 : 1 };
      const changed = entries.update(USER_ID, id, patch, NOW)!;
      assert.equal(touchesMapping(patch, changed), false);
      assert.equal(changed.sync, current.sync, "the sync state does not move");
    }
    await service.idle();
  });
  assert.equal(result.methods.length, before, "no request after the indent changes");
});
