import assert from "node:assert/strict";
import test from "node:test";
import { CalDavClient, CalDavError } from "../src/caldav/client.ts";
import { loadCalDavConfig, parseLists } from "../src/caldav/config.ts";
import { caldavSource, demoSource, loadBacklog } from "../src/caldav/source.ts";
import { fakeEnv, LIST_PATHS, PASSWORD, startFakeCalDav, USER, type FakeCalDav } from "./fake-caldav.ts";

async function withFake(fn: (fake: FakeCalDav, client: CalDavClient) => Promise<void>, options?: Parameters<typeof startFakeCalDav>[0]) {
  const fake = await startFakeCalDav(options);
  try {
    await fn(fake, new CalDavClient({ base: fake.base, user: USER, password: PASSWORD }));
  } finally {
    await fake.close();
  }
}

test("listTasks reads every fixture VTODO and maps the mixed values", async () => {
  await withFake(async (_fake, client) => {
    const tasks = await client.listTasks({ name: "Aufgaben", path: LIST_PATHS.Aufgaben });
    assert.equal(tasks.length, 7);
    const by = (uid: string) => tasks.find((task) => task.uid === uid)!;

    const gutachten = by("fx-gutachten");
    assert.equal(gutachten.list, "Aufgaben");
    assert.equal(gutachten.summary, "Gutachten lesen, kommentieren; abgeben");
    assert.equal(gutachten.description, "Erste Zeile\nZweite Zeile mit einem sehr langen Satz, der in der Datei umgebrochen wurde, damit die Zeile nicht zu lang wird.");
    assert.equal(gutachten.priority, 1);
    assert.equal(gutachten.due?.date, "2026-12-01");
    assert.equal(gutachten.due?.allDay, true);
    assert.deepEqual(gutachten.categories, ["Arbeit, intern", "Gutachten"]);
    assert.equal(gutachten.etag, '"etag-0"');
    assert.match(gutachten.href, /^http:\/\/127\.0\.0\.1:\d+\/dav\/calendars\/test\/aufgaben\/gutachten\.ics$/);

    const termin = by("fx-termin");
    assert.equal(termin.priority, 5);
    assert.equal(termin.due?.date, "2026-11-24");
    assert.equal(termin.due?.time, "09:30:00");
    assert.equal(termin.due?.tzid, "Europe/Berlin");

    assert.equal(by("fx-someday").priority, 9);
    assert.equal(by("fx-someday").someday, true);
    assert.equal(by("fx-unset").priority, null);
    assert.equal(by("fx-unset").status, "NEEDS-ACTION");

    const done = by("fx-done");
    assert.equal(done.status, "COMPLETED");
    assert.equal(done.percentComplete, 100);
    assert.equal(done.completed, "20261105T101500Z");

    const process = by("fx-process");
    assert.equal(process.status, "IN-PROCESS");
    assert.ok(process.unknownProps.includes("RELATED-TO:fx-done"));
    assert.ok(process.unknownProps.includes("X-CUSTOM-FLAG;X-PARAM=1:keep me"));
    assert.ok(process.unknownProps.includes("BEGIN:VALARM"));

    assert.equal(by("fx-cancelled").status, "CANCELLED");
  });
});

test("the client sends REPORT calendar-query for VTODO with depth 1, PROPFIND with depth 0, and basic auth", async () => {
  await withFake(async (fake, client) => {
    await client.queryTodos(LIST_PATHS.Aufgaben);
    const info = await client.describeCollection(LIST_PATHS.Arbeit);
    assert.deepEqual(info, { displayName: "Fixture list", isCalendar: true, components: ["VTODO"] });

    const [report, propfind] = fake.requests;
    assert.equal(report.method, "REPORT");
    assert.equal(report.depth, "1");
    assert.match(report.body, /calendar-query/);
    assert.match(report.body, /comp-filter name="VTODO"/);
    assert.equal(propfind.method, "PROPFIND");
    assert.equal(propfind.depth, "0");
    assert.equal(report.authorization, `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`);
  });
});

test("the fake server never receives PUT, DELETE or any other write", async () => {
  await withFake(async (fake, client) => {
    const source = caldavSource(loadCalDavConfig(fakeEnv(fake))!, client);
    await loadBacklog(source, true);
    await client.describeCollection(LIST_PATHS.Aufgaben);
    await client.listTasks({ name: "Arbeit", path: LIST_PATHS.Arbeit });
    assert.ok(fake.requests.length >= 4);
    const methods = new Set(fake.requests.map((request) => request.method));
    assert.deepEqual([...methods].sort(), ["PROPFIND", "REPORT"]);
    for (const forbidden of ["PUT", "DELETE", "PROPPATCH", "POST", "MKCALENDAR", "MOVE", "COPY"]) {
      assert.ok(!methods.has(forbidden), `${forbidden} reached the server`);
    }
  });
});

test("the client module has no write methods", () => {
  const names = Object.getOwnPropertyNames(CalDavClient.prototype);
  assert.deepEqual(names.filter((name) => /put|delete|create|update|write|save|remove/i.test(name)), []);
});

test("wrong credentials give a CalDavError with the status and no secrets in the message", async () => {
  await withFake(async (fake) => {
    const client = new CalDavClient({ base: fake.base, user: USER, password: "wrong-password" });
    await assert.rejects(client.listTasks({ name: "Aufgaben", path: LIST_PATHS.Aufgaben }), (error: unknown) => {
      assert.ok(error instanceof CalDavError);
      assert.equal(error.status, 401);
      assert.ok(!error.message.includes("wrong-password"));
      assert.ok(!error.message.includes(fake.base));
      return true;
    });
  });
});

test("a server error and a missing collection are CalDavErrors", async () => {
  await withFake(async (fake, client) => {
    await assert.rejects(client.queryTodos("/dav/calendars/test/nope/"), (error: unknown) => error instanceof CalDavError && error.status === 404);
    assert.ok(fake.requests.length === 1);
  });
  await withFake(async (_fake, client) => {
    await assert.rejects(client.queryTodos(LIST_PATHS.Aufgaben), (error: unknown) => error instanceof CalDavError && error.status === 503);
  }, { failWith: 503 });
});

test("a list path cannot leave the server origin", async () => {
  await withFake(async (fake, client) => {
    await assert.rejects(client.queryTodos("http://example.invalid/dav/"), CalDavError);
    assert.equal(fake.requests.length, 0);
  });
});

test("the backlog is sorted and shows open items by default", async () => {
  await withFake(async (fake) => {
    const source = caldavSource(loadCalDavConfig(fakeEnv(fake))!);
    const open = await loadBacklog(source, false);
    assert.ok(open.every((task) => task.status === "NEEDS-ACTION" || task.status === "IN-PROCESS"));
    assert.deepEqual(open.map((task) => task.uid), ["fx-termin", "fx-bericht", "fx-gutachten", "fx-process", "fx-someday", "fx-unset"]);
    assert.deepEqual([...new Set(open.map((task) => task.list))].sort(), ["Aufgaben", "Arbeit"].sort());
    const all = await loadBacklog(source, true);
    assert.equal(all.length, 8);
    // The view has no raw properties and no etag or href.
    assert.ok(!("unknownProps" in open[0]) && !("href" in open[0]) && !("etag" in open[0]));
  });
});

test("config: nothing set means the demo source, a full set parses, a half set throws", () => {
  assert.equal(loadCalDavConfig({}), null);
  const config = loadCalDavConfig({ BUJO_CALDAV_BASE: "https://cloud.example.test", BUJO_CALDAV_USER: "u", BUJO_CALDAV_PASSWORD: "p", BUJO_CALDAV_LISTS: "Aufgaben=/a/tasks/, Arbeit=/a/arbeit/" });
  assert.deepEqual(config?.lists, [{ name: "Aufgaben", path: "/a/tasks/" }, { name: "Arbeit", path: "/a/arbeit/" }]);
  assert.throws(() => loadCalDavConfig({ BUJO_CALDAV_BASE: "https://cloud.example.test" }), /BUJO_CALDAV_LISTS/);
  assert.throws(() => loadCalDavConfig({ BUJO_CALDAV_LISTS: "A=/a/" }), /BUJO_CALDAV_BASE/);
  assert.throws(() => loadCalDavConfig({ BUJO_CALDAV_BASE: "not a url", BUJO_CALDAV_LISTS: "A=/a/" }), /valid URL/);
  assert.throws(() => parseLists("Aufgaben"), /name=path/);
  assert.throws(() => parseLists("A=/a/,A=/b/"), /twice/);
});

test("the demo source works with nothing configured", async () => {
  const tasks = await loadBacklog(demoSource(), false);
  assert.ok(tasks.length >= 6);
  assert.deepEqual([...new Set(tasks.map((task) => task.list))].sort(), ["Arbeit", "Aufgaben"]);
  assert.ok(tasks.some((task) => task.someday));
  assert.ok(tasks.some((task) => task.due && !task.due.allDay));
});
