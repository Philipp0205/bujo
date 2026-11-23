import assert from "node:assert/strict";
import test from "node:test";
import { CalDavClient } from "../src/caldav/client.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { buildNewTodo, editTodo, escapeText, foldLine, parseVTodos } from "../src/caldav/ics.ts";
import { caldavSource, demoSource, TaskConflictError, TaskNotFoundError, UnknownListError } from "../src/caldav/source.ts";
import { fakeEnv, LIST_PATHS, PASSWORD, startFakeCalDav, USER, type FakeCalDav } from "./fake-caldav.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 30, 45);

async function withSource(fn: (fake: FakeCalDav, source: ReturnType<typeof caldavSource>) => Promise<void>) {
  const fake = await startFakeCalDav();
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
    const client = new CalDavClient({ base: fake.base, user: USER, password: PASSWORD });
    let n = 0;
    await fn(fake, caldavSource(config, client, { now: () => NOW, uuid: () => `new-uid-${++n}` }));
  } finally {
    await fake.close();
  }
}

const unfolded = (ics: string) => ics.replace(/\r\n[ \t]/g, "");

test("buildNewTodo writes a folded, escaped VTODO with CRLF, DATE due and no DTSTART", () => {
  const ics = buildNewTodo(
    {
      uid: "u-1",
      summary: "Gutachten lesen, kommentieren; abgeben und danach noch einen sehr langen Satz mit Umlauten: äöü ß",
      description: "Zeile eins\nZeile zwei, mit Komma",
      due: "2026-12-01",
      priority: 1,
      categories: ["Arbeit, intern", "Büro"],
    },
    NOW,
  );
  assert.ok(ics.endsWith("\r\n"));
  assert.ok(!/[^\r]\n/.test(ics), "every line break is CRLF");
  for (const line of ics.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, `line too long: ${line}`);
  const text = unfolded(ics);
  for (const expected of [
    "UID:u-1",
    "DTSTAMP:20261120T123045Z",
    "CREATED:20261120T123045Z",
    "LAST-MODIFIED:20261120T123045Z",
    "STATUS:NEEDS-ACTION",
    "PRIORITY:1",
    "DUE;VALUE=DATE:20261201",
    "CATEGORIES:Arbeit\\, intern,Büro",
    "DESCRIPTION:Zeile eins\\nZeile zwei\\, mit Komma",
  ]) {
    assert.ok(text.includes(expected), `missing ${expected}`);
  }
  assert.ok(!/DTSTART/i.test(ics));
  const [todo] = parseVTodos(ics);
  assert.equal(todo.summary, "Gutachten lesen, kommentieren; abgeben und danach noch einen sehr langen Satz mit Umlauten: äöü ß");
  assert.equal(todo.description, "Zeile eins\nZeile zwei, mit Komma");
  assert.deepEqual(todo.categories, ["Arbeit, intern", "Büro"]);
  assert.equal(todo.due?.date, "2026-12-01");
  assert.equal(todo.priority, 1);
});

test("foldLine never splits a multi-byte character and unfolding gives the line back", () => {
  const line = `SUMMARY:${"ä".repeat(100)}`;
  const folded = foldLine(line);
  assert.ok(folded.length > 1);
  for (const part of folded) assert.ok(Buffer.byteLength(part) <= 75);
  assert.equal(folded.join("\r\n").replace(/\r\n /g, ""), line);
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test("editTodo keeps unknown props, a nested VALARM, a TZID DUE and the folding of untouched lines", () => {
  const original = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VTODO",
    "UID:e-1",
    "SUMMARY:Alt",
    "DESCRIPTION:Eine lange Beschreibung, die in der Datei umgebrochen wurde und dabei ein",
    " e Folgezeile hat.",
    "DUE;TZID=Europe/Berlin:20261124T093000",
    "DTSTART;TZID=Europe/Berlin:20261120T090000",
    "RELATED-TO:parent-1",
    "X-CUSTOM;X-PARAM=1:keep me",
    "SEQUENCE:4",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VTODO",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const { ics, changed } = editTodo(original, "e-1", { summary: "Neu, mit Komma", priority: 5 }, NOW);
  assert.ok(changed);
  for (const kept of [
    "DESCRIPTION:Eine lange Beschreibung, die in der Datei umgebrochen wurde und dabei ein\r\n e Folgezeile hat.",
    "DUE;TZID=Europe/Berlin:20261124T093000",
    "DTSTART;TZID=Europe/Berlin:20261120T090000",
    "RELATED-TO:parent-1",
    "X-CUSTOM;X-PARAM=1:keep me",
    "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM",
  ]) {
    assert.ok(ics.includes(kept), `lost: ${kept}`);
  }
  assert.ok(ics.includes("SUMMARY:Neu\\, mit Komma"));
  assert.ok(ics.includes("PRIORITY:5"));
  assert.ok(ics.includes("LAST-MODIFIED:20261120T123045Z"));
  assert.ok(ics.includes("DTSTAMP:20261120T123045Z"));
  assert.ok(ics.includes("SEQUENCE:5"));
  assert.equal(ics.match(/SEQUENCE/g)?.length, 1);
  // New properties sit before the VALARM block, not inside it.
  assert.ok(ics.indexOf("PRIORITY:5") < ics.indexOf("BEGIN:VALARM"));
  assert.ok(!ics.includes("DTSTART:"), "no DTSTART is added");
  // The same date leaves the TZID line alone, a new date replaces it with a DATE value.
  assert.ok(editTodo(original, "e-1", { due: "2026-11-24", summary: "Neu" }, NOW).ics.includes("DUE;TZID=Europe/Berlin:20261124T093000"));
  assert.ok(editTodo(original, "e-1", { due: "2026-11-25" }, NOW).ics.includes("DUE;VALUE=DATE:20261125"));
  // A patch that changes nothing returns the text as it came.
  const noop = editTodo(original, "e-1", { summary: "Alt", priority: null }, NOW);
  assert.equal(noop.changed, false);
  assert.equal(noop.ics, original);
});

test("editTodo someday adds or removes only that tag", () => {
  const base = buildNewTodo({ uid: "s-1", summary: "x", categories: ["Haushalt"] }, NOW);
  const added = editTodo(base, "s-1", { someday: true }, NOW).ics;
  assert.deepEqual(parseVTodos(added)[0].categories, ["Haushalt", "someday"]);
  const removed = editTodo(added, "s-1", { someday: false }, NOW).ics;
  assert.deepEqual(parseVTodos(removed)[0].categories, ["Haushalt"]);
  assert.equal(editTodo(base, "s-1", { someday: false }, NOW).changed, false);
});

test("buildNewTodo cancel writes STATUS:CANCELLED, and editTodo cancel turns a finished task into a cancelled one", () => {
  const fresh = buildNewTodo({ uid: "c-1", summary: "x", cancel: true }, NOW);
  assert.equal(parseVTodos(fresh)[0].status, "CANCELLED");
  assert.equal(fresh.includes("COMPLETED"), false);
  const done = editTodo(buildNewTodo({ uid: "c-2", summary: "x" }, NOW), "c-2", { complete: true }, NOW).ics;
  const cancelled = editTodo(done, "c-2", { cancel: true }, NOW + 1000);
  assert.equal(cancelled.changed, true);
  assert.equal(parseVTodos(cancelled.ics)[0].status, "CANCELLED");
  assert.equal(/COMPLETED:|PERCENT-COMPLETE/.test(cancelled.ics), false);
  assert.equal(editTodo(cancelled.ics, "c-2", { cancel: true }, NOW + 2000).changed, false);
});

test("create PUTs <list>/<uid>.ics with If-None-Match: * and returns the read-back task", async () => {
  await withSource(async (fake, source) => {
    const task = await source.create("Aufgaben", {
      summary: "Zahnarzt, Kontrolle; später",
      description: "Bitte Karte mitnehmen,\nund Röntgenbilder",
      due: "2026-12-03",
      priority: 5,
      categories: ["Gesundheit", "Büro, intern"],
    });
    const put = fake.requests.find((request) => request.method === "PUT")!;
    assert.equal(put.url, `${LIST_PATHS.Aufgaben}new-uid-1.ics`);
    assert.equal(put.ifNoneMatch, "*");
    assert.equal(put.ifMatch, undefined);
    assert.ok(put.body.includes("DUE;VALUE=DATE:20261203"));
    assert.ok(!/DTSTART/.test(put.body));
    // Read back after the write: a GET follows the PUT.
    const putIndex = fake.requests.indexOf(put);
    assert.equal(fake.requests[putIndex + 1].method, "GET");
    assert.equal(task.uid, "new-uid-1");
    assert.equal(task.list, "Aufgaben");
    assert.equal(task.summary, "Zahnarzt, Kontrolle; später");
    assert.equal(task.description, "Bitte Karte mitnehmen,\nund Röntgenbilder");
    assert.deepEqual(task.categories, ["Gesundheit", "Büro, intern"]);
    assert.equal(task.priority, 5);
    assert.equal(task.due?.date, "2026-12-03");
    assert.equal(task.status, "NEEDS-ACTION");
    assert.ok(task.etag);
    assert.ok((await source.load()).some((item) => item.uid === "new-uid-1"));
  });
});

test("update changes only the edited props of a real fixture and keeps VALARM, RELATED-TO, X- and DTSTART", async () => {
  await withSource(async (fake, source) => {
    const before = fake.read(LIST_PATHS.Aufgaben, "process.ics")!;
    const task = await source.update("Aufgaben", "fx-process", { summary: "Umzug planen, Etappe 2", priority: 1 });
    const put = fake.requests.find((request) => request.method === "PUT")!;
    assert.equal(put.url, `${LIST_PATHS.Aufgaben}process.ics`);
    assert.match(put.ifMatch ?? "", /^"etag-\d+"$/);
    assert.equal(put.ifNoneMatch, undefined);
    const after = fake.read(LIST_PATHS.Aufgaben, "process.ics")!;
    for (const kept of ["RELATED-TO:fx-done", "X-CUSTOM-FLAG;X-PARAM=1:keep me", "DTSTART;TZID=Europe/Berlin:20261120T090000", "BEGIN:VALARM", "TRIGGER:-PT15M", "STATUS:IN-PROCESS", "PERCENT-COMPLETE:40"]) {
      assert.ok(after.includes(kept), `lost ${kept}`);
      assert.ok(before.includes(kept));
    }
    assert.equal(task.summary, "Umzug planen, Etappe 2");
    assert.equal(task.priority, 1);
    assert.equal(task.status, "IN-PROCESS");
    assert.ok(task.unknownProps.includes("RELATED-TO:fx-done"));
  });
});

test("update keeps an untouched TZID DUE as it was, and a new date writes a DATE value", async () => {
  await withSource(async (fake, source) => {
    await source.update("Aufgaben", "fx-termin", { summary: "Zahnarzt anrufen, morgen" });
    assert.ok(fake.read(LIST_PATHS.Aufgaben, "termin.ics")!.includes("DUE;TZID=Europe/Berlin:20261124T093000"));
    const moved = await source.update("Aufgaben", "fx-termin", { due: "2026-11-30" });
    assert.ok(fake.read(LIST_PATHS.Aufgaben, "termin.ics")!.includes("DUE;VALUE=DATE:20261130"));
    assert.equal(moved.due?.date, "2026-11-30");
    assert.equal(moved.due?.allDay, true);
  });
});

test("update with no change sends no PUT", async () => {
  await withSource(async (fake, source) => {
    const task = await source.update("Aufgaben", "fx-termin", { priority: 5 });
    assert.equal(task.uid, "fx-termin");
    assert.ok(!fake.requests.some((request) => request.method === "PUT"));
  });
});

test("complete sets STATUS:COMPLETED, a UTC COMPLETED stamp and PERCENT-COMPLETE:100", async () => {
  await withSource(async (fake, source) => {
    const task = await source.update("Arbeit", "fx-bericht", { complete: true });
    assert.equal(task.status, "COMPLETED");
    assert.equal(task.completed, "20261120T123045Z");
    assert.equal(task.percentComplete, 100);
    const stored = fake.read(LIST_PATHS.Arbeit, "bericht.ics")!;
    assert.ok(stored.includes("STATUS:COMPLETED"));
    assert.ok(!stored.includes("NEEDS-ACTION"));
    assert.equal(stored.match(/^STATUS:/gm)?.length, 1);
    assert.ok(stored.includes("DUE;VALUE=DATE:20261130"));
  });
});

test("a task that changed meanwhile is a conflict: the PUT gets 412 and nothing is overwritten", async () => {
  const fake = await startFakeCalDav();
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
    // Another client changes the object between our GET and our PUT.
    const racing = new CalDavClient({
      base: fake.base,
      user: USER,
      password: PASSWORD,
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (init?.method === "GET") fake.touch(LIST_PATHS.Aufgaben, "termin.ics", fake.read(LIST_PATHS.Aufgaben, "termin.ics")!.replace("Zahnarzt anrufen", "Zahnarzt, von jemand anderem"));
        return response;
      },
    });
    const source = caldavSource(config, racing, { now: () => NOW });
    await assert.rejects(source.update("Aufgaben", "fx-termin", { priority: 1 }), TaskConflictError);
    const stored = fake.read(LIST_PATHS.Aufgaben, "termin.ics")!;
    assert.ok(stored.includes("von jemand anderem"));
    assert.ok(!stored.includes("PRIORITY:1"));
  } finally {
    await fake.close();
  }
});

test("create refuses to overwrite: a UID that exists answers 412, which is a conflict", async () => {
  const fake = await startFakeCalDav();
  try {
    // The fixture file is gutachten.ics, so this uuid names an existing resource.
    const source = caldavSource(loadCalDavConfig(fakeEnv(fake))!, undefined, { uuid: () => "gutachten" });
    await assert.rejects(source.create("Aufgaben", { summary: "Doppelt" }), TaskConflictError);
    assert.ok(!fake.read(LIST_PATHS.Aufgaben, "gutachten.ics")!.includes("Doppelt"));
  } finally {
    await fake.close();
  }
});

test("unknown list and unknown uid are typed errors, and nothing is written", async () => {
  await withSource(async (fake, source) => {
    await assert.rejects(source.create("Nope", { summary: "x" }), UnknownListError);
    await assert.rejects(source.update("Aufgaben", "does-not-exist", { summary: "x" }), TaskNotFoundError);
    assert.equal(await source.get("Aufgaben", "does-not-exist"), undefined);
    assert.ok(!fake.requests.some((request) => request.method === "PUT"));
  });
});

test("the CalDAV client refuses a PUT without an ETag and the fake never sees DELETE across a full write session", async () => {
  await withSource(async (fake, source) => {
    const created = await source.create("Aufgaben", { summary: "Ein, zwei; drei" });
    await source.update("Aufgaben", created.uid, { summary: "Vier", categories: ["a"] });
    await source.update("Aufgaben", created.uid, { complete: true });
    const methods = new Set(fake.requests.map((request) => request.method));
    assert.ok(methods.has("PUT"));
    for (const forbidden of ["DELETE", "PROPPATCH", "POST", "MKCALENDAR", "MKCOL", "MOVE", "COPY"]) {
      assert.ok(!methods.has(forbidden), `${forbidden} reached the server`);
    }
    // Every PUT carried a precondition.
    for (const request of fake.requests.filter((item) => item.method === "PUT")) {
      assert.ok(request.ifMatch !== undefined || request.ifNoneMatch === "*");
    }
  });
  const client = new CalDavClient({ base: "http://127.0.0.1:1", user: USER, password: PASSWORD });
  await assert.rejects(client.putExisting("/x/y.ics", "BEGIN:VCALENDAR", ""), /ETag/);
});

test("demo source writes in memory, with the same rules, and never leaves the process", async () => {
  let n = 0;
  const source = demoSource({ now: () => NOW, uuid: () => `demo-new-${++n}` });
  const created = await source.create("Arbeit", { summary: "Bericht, fertig; prüfen", due: "2026-12-05", categories: ["Büro"] });
  assert.equal(created.uid, "demo-new-1");
  assert.equal(created.summary, "Bericht, fertig; prüfen");
  const updated = await source.update("Aufgaben", "demo-3", { summary: "Geschenke kaufen" });
  assert.equal(updated.due?.tzid, "Europe/Berlin", "an untouched TZID due stays");
  assert.notEqual(updated.etag, created.etag);
  const done = await source.update("Aufgaben", "demo-2", { complete: true });
  assert.equal(done.status, "COMPLETED");
  assert.equal((await source.load()).length, 10);
  // A second demo source starts fresh.
  assert.equal((await demoSource().load()).length, 9);
});
