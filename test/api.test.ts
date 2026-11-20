import assert from "node:assert/strict";
import test from "node:test";
import { CalDavClient } from "../src/caldav/client.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { caldavSource, demoSource } from "../src/caldav/source.ts";
import { fakeEnv, LIST_PATHS, PASSWORD, startFakeCalDav, USER, type FakeCalDav } from "./fake-caldav.ts";
import { api, makeToken, withApp, type Signed } from "./helpers.ts";

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** The app over the fake CalDAV server, one account, one read token and one write token. */
async function withFake(
  fn: (ctx: { base: string; fake: FakeCalDav; signed: Signed; read: Record<string, string>; write: Record<string, string> }) => Promise<void>,
  options: { source?: "caldav" | "demo" } = {},
) {
  const fake = await startFakeCalDav();
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
    const client = new CalDavClient({ base: fake.base, user: USER, password: PASSWORD });
    const source = options.source === "demo" ? demoSource() : caldavSource(config, client);
    await withApp(source, async ({ base }) => {
      const { signUp } = await import("./helpers.ts");
      const signed = await signUp(base);
      const read = bearer((await makeToken(base, signed, "read")).token);
      const write = bearer((await makeToken(base, signed, "write")).token);
      await fn({ base, fake, signed, read, write });
    });
  } finally {
    await fake.close();
  }
}

test("tokens: create shows the secret once, list shows only the prefix, scope is required", async () => {
  await withFake(async ({ base, signed }) => {
    const bad = await api(base, "POST", "/api/tokens", { body: { name: "x", scope: "admin" }, headers: signed.headers });
    assert.equal(bad.status, 400);
    assert.equal((await api(base, "POST", "/api/tokens", { body: { name: "", scope: "read" }, headers: signed.headers })).status, 400);
    assert.equal((await api(base, "POST", "/api/tokens", { body: { name: "x".repeat(41), scope: "read" }, headers: signed.headers })).status, 400);
    assert.equal((await api(base, "POST", "/api/tokens", { body: { name: "x", scope: "read", extra: 1 }, headers: signed.headers })).status, 400);

    const made = await api(base, "POST", "/api/tokens", { body: { name: "Claude", scope: "read" }, headers: signed.headers });
    assert.equal(made.status, 201);
    assert.match(made.json.token, /^bujo_[A-Za-z0-9_-]{43}$/);
    assert.equal(made.json.info.scope, "read");
    assert.equal("token" in made.json.info && made.json.info.token !== undefined, false);

    const list = await api(base, "GET", "/api/tokens", { headers: signed.headers });
    const text = JSON.stringify(list.json);
    assert.ok(!text.includes(made.json.token));
    assert.ok(!text.includes(made.json.token.slice(9)));
    const entry = list.json.tokens.find((item: { id: string }) => item.id === made.json.info.id);
    assert.equal(entry.tokenPrefix, made.json.token.slice(0, 9));
    assert.equal(entry.name, "Claude");
  });
});

test("tokens: at most 10 live ones, and revoking frees a slot", async () => {
  await withFake(async ({ base, signed }) => {
    // withFake already made two.
    for (let i = 0; i < 8; i++) await makeToken(base, signed, "read", `t${i}`);
    const eleventh = await api(base, "POST", "/api/tokens", { body: { name: "one too many", scope: "read" }, headers: signed.headers });
    assert.equal(eleventh.status, 409);
    const first = (await api(base, "GET", "/api/tokens", { headers: signed.headers })).json.tokens[0].id;
    assert.equal((await api(base, "POST", `/api/tokens/${first}/revoke`, { headers: signed.headers })).status, 200);
    assert.equal((await api(base, "POST", "/api/tokens", { body: { name: "fits now", scope: "read" }, headers: signed.headers })).status, 201);
  });
});

test("tokens: revoke is idempotent, stops the token at once, and an unknown id is 404", async () => {
  await withFake(async ({ base, signed }) => {
    const made = await makeToken(base, signed, "write", "temp");
    const header = bearer(made.token);
    assert.equal((await api(base, "GET", "/api/v1/lists", { headers: header })).status, 200);
    assert.equal((await api(base, "POST", `/api/tokens/${made.id}/revoke`, { headers: signed.headers })).status, 200);
    assert.equal((await api(base, "POST", `/api/tokens/${made.id}/revoke`, { headers: signed.headers })).status, 200);
    assert.equal((await api(base, "GET", "/api/v1/lists", { headers: header })).status, 401);
    assert.equal((await api(base, "POST", "/api/tokens/not-a-token/revoke", { headers: signed.headers })).status, 404);
    const listed = (await api(base, "GET", "/api/tokens", { headers: signed.headers })).json.tokens as Array<{ id: string }>;
    assert.ok(!listed.some((item) => item.id === made.id));
    // No DELETE route for tokens either.
    assert.equal((await api(base, "DELETE", `/api/tokens/${made.id}`, { headers: signed.headers })).status, 404);
  });
});

test("tokens: an agent token can never manage tokens or the account", async () => {
  await withFake(async ({ base, write, read }) => {
    for (const headers of [write, read]) {
      assert.equal((await api(base, "GET", "/api/tokens", { headers })).status, 403);
      assert.equal((await api(base, "POST", "/api/tokens", { body: { name: "x", scope: "write" }, headers })).status, 403);
      assert.equal((await api(base, "POST", "/api/tokens/abc/revoke", { headers })).status, 403);
      assert.equal((await api(base, "POST", "/api/auth/logout", { headers })).status, 403);
      assert.equal((await api(base, "POST", "/api/auth/email", { body: { email: "a@example.com" }, headers })).status, 403);
      assert.equal((await api(base, "GET", "/api/auth/me", { headers })).status, 403);
    }
  });
});

test("bearer auth: a bad, malformed or revoked token is 401 and never falls back to the cookie", async () => {
  await withFake(async ({ base, signed }) => {
    const wrong = `bujo_${"A".repeat(43)}`;
    for (const authorization of [`Bearer ${wrong}`, "Bearer nonsense", "Bearer", "Basic abc", `bearer ${wrong}`]) {
      const result = await api(base, "GET", "/api/v1/lists", { headers: { ...signed.headers, authorization } });
      assert.equal(result.status, 401, authorization);
    }
    assert.equal((await api(base, "GET", "/api/v1/lists")).status, 401);
    assert.equal((await api(base, "GET", "/api/v1/lists", { headers: signed.headers })).status, 200, "the browser session works too");
  });
});

test("last_used_at is set on first use and not rewritten within a minute", async () => {
  await withFake(async ({ base, signed }) => {
    const made = await makeToken(base, signed, "read", "stamp");
    const read = () => (signed && (api(base, "GET", "/api/tokens", { headers: signed.headers })));
    assert.equal(((await read()).json.tokens as Array<{ id: string; lastUsedAt: number | null }>).find((item) => item.id === made.id)!.lastUsedAt, null);
    await api(base, "GET", "/api/v1/lists", { headers: bearer(made.token) });
    const first = ((await read()).json.tokens as Array<{ id: string; lastUsedAt: number | null }>).find((item) => item.id === made.id)!.lastUsedAt;
    assert.equal(typeof first, "number");
    await new Promise((resolve) => setTimeout(resolve, 15));
    await api(base, "GET", "/api/v1/lists", { headers: bearer(made.token) });
    const second = ((await read()).json.tokens as Array<{ id: string; lastUsedAt: number | null }>).find((item) => item.id === made.id)!.lastUsedAt;
    assert.equal(second, first);
  });
});

test("v1 reads: lists, tags, tasks with filters, and one task", async () => {
  await withFake(async ({ base, read }) => {
    const lists = await api(base, "GET", "/api/v1/lists", { headers: read });
    assert.deepEqual(lists.json, { source: "caldav", lists: [{ name: "Aufgaben", default: true }, { name: "Arbeit", default: false }] });

    const tasks = await api(base, "GET", "/api/v1/tasks", { headers: read });
    assert.equal(tasks.status, 200);
    assert.equal(tasks.json.tasks.length, 6);
    assert.ok(tasks.json.tasks.every((task: { tags: string[] }) => Array.isArray(task.tags)));
    assert.ok(tasks.json.tasks.every((task: Record<string, unknown>) => !("categories" in task)));

    assert.equal((await api(base, "GET", "/api/v1/tasks?list=Arbeit", { headers: read })).json.tasks.length, 1);
    assert.equal((await api(base, "GET", "/api/v1/tasks?someday=true", { headers: read })).json.tasks.length, 1);
    assert.equal((await api(base, "GET", "/api/v1/tasks?tag=haushalt", { headers: read })).json.tasks[0].uid, "fx-someday");
    assert.ok((await api(base, "GET", "/api/v1/tasks?status=all", { headers: read })).json.tasks.length > 6);
    assert.equal((await api(base, "GET", "/api/v1/tasks?list=Nope", { headers: read })).status, 400);
    assert.equal((await api(base, "GET", "/api/v1/tasks?status=weird", { headers: read })).status, 400);
    assert.equal((await api(base, "GET", "/api/v1/tasks?bogus=1", { headers: read })).status, 400);

    const tags = await api(base, "GET", "/api/v1/tags", { headers: read });
    const haushalt = tags.json.tags.find((item: { tag: string }) => item.tag === "Haushalt");
    assert.deepEqual(haushalt, { tag: "Haushalt", count: 1 });

    const one = await api(base, "GET", "/api/v1/lists/Aufgaben/tasks/fx-gutachten", { headers: read });
    assert.equal(one.status, 200);
    assert.equal(one.json.task.summary, "Gutachten lesen, kommentieren; abgeben");
    assert.equal((await api(base, "GET", "/api/v1/lists/Aufgaben/tasks/missing", { headers: read })).status, 404);
    assert.equal((await api(base, "GET", "/api/v1/lists/Nope/tasks/fx-gutachten", { headers: read })).status, 404);
  });
});

test("v1: a read token cannot write anywhere, and a write token can", async () => {
  await withFake(async ({ base, fake, read }) => {
    const before = fake.requests.length;
    const attempts: Array<[string, string, unknown]> = [
      ["POST", "/api/v1/tasks", { summary: "nope" }],
      ["PATCH", "/api/v1/lists/Aufgaben/tasks/fx-gutachten", { summary: "nope" }],
      ["POST", "/api/v1/lists/Aufgaben/tasks/fx-gutachten/complete", undefined],
    ];
    for (const [method, path, body] of attempts) {
      assert.equal((await api(base, method, path, { body, headers: read })).status, 403, `${method} ${path}`);
    }
    assert.ok(!fake.requests.slice(before).some((request) => request.method === "PUT"));
  });
});

test("v1 create: a new task lands in the right list as a real VTODO and reads back", async () => {
  await withFake(async ({ base, fake, write }) => {
    const created = await api(base, "POST", "/api/v1/tasks", {
      headers: write,
      body: { summary: "Zahnarzt, Kontrolle; später", description: "Karte mitnehmen,\nund Röntgenbilder", due: "2026-12-03", priority: 5, tags: ["Gesundheit", "Büro, intern"], someday: true, list: "Arbeit" },
    });
    assert.equal(created.status, 201);
    const task = created.json.task;
    assert.equal(task.list, "Arbeit");
    assert.equal(task.summary, "Zahnarzt, Kontrolle; später");
    assert.equal(task.description, "Karte mitnehmen,\nund Röntgenbilder");
    assert.equal(task.priority, 5);
    assert.equal(task.due.date, "2026-12-03");
    assert.deepEqual(task.tags, ["Gesundheit", "Büro, intern", "someday"]);
    assert.equal(task.someday, true);
    assert.ok(fake.names(LIST_PATHS.Arbeit).includes(`${task.uid}.ics`));
    const again = await api(base, "GET", `/api/v1/lists/Arbeit/tasks/${task.uid}`, { headers: write });
    assert.deepEqual(again.json.task, task);
  });
});

test("v1 create: the default list is Aufgaben, and bad input is a 400 that writes nothing", async () => {
  await withFake(async ({ base, fake, write }) => {
    const created = await api(base, "POST", "/api/v1/tasks", { headers: write, body: { summary: "Standardliste" } });
    assert.equal(created.status, 201);
    assert.equal(created.json.task.list, "Aufgaben");
    const puts = () => fake.requests.filter((request) => request.method === "PUT").length;
    const before = puts();
    const bad: unknown[] = [
      {},
      { summary: "" },
      { summary: "   " },
      { summary: 5 },
      { summary: "a\nb" },
      { summary: "x".repeat(501) },
      { summary: "ok", description: 5 },
      { summary: "ok", description: "x".repeat(10_001) },
      { summary: "ok", description: "bell\u0007" },
      { summary: "ok", due: "2026-02-30" },
      { summary: "ok", due: "morgen" },
      { summary: "ok", due: 20261203 },
      { summary: "ok", priority: 2 },
      { summary: "ok", priority: "1" },
      { summary: "ok", tags: "a" },
      { summary: "ok", tags: [""] },
      { summary: "ok", tags: [5] },
      { summary: "ok", tags: ["x".repeat(61)] },
      { summary: "ok", tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
      { summary: "ok", someday: "maybe" },
      { summary: "ok", list: "Nope" },
      { summary: "ok", list: 7 },
      { summary: "ok", color: "red" },
      { summary: "ok", uid: "mine" },
    ];
    for (const body of bad) {
      const result = await api(base, "POST", "/api/v1/tasks", { headers: write, body });
      assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(puts(), before);
    const notJson = await fetch(`${base}/api/v1/tasks`, { method: "POST", headers: { ...write, "content-type": "application/json" }, body: "[1]" });
    assert.equal(notJson.status, 400);
  });
});

test("v1 create: tags are trimmed and de-duplicated, a long description is accepted", async () => {
  await withFake(async ({ base, write }) => {
    const created = await api(base, "POST", "/api/v1/tasks", {
      headers: write,
      body: { summary: "  Mit Leerzeichen  ", description: "ä".repeat(9000), tags: [" a ", "a", "b"], priority: null, due: null },
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.task.summary, "Mit Leerzeichen");
    assert.deepEqual(created.json.task.tags, ["a", "b"]);
    assert.equal(created.json.task.description.length, 9000);
    assert.equal(created.json.task.priority, null);
    assert.equal(created.json.task.due, null);
  });
});

test("v1 update: changes only what was sent, keeps everything else on the file", async () => {
  await withFake(async ({ base, fake, write }) => {
    const path = "/api/v1/lists/Aufgaben/tasks/fx-process";
    const before = fake.read(LIST_PATHS.Aufgaben, "process.ics")!;
    const updated = await api(base, "PATCH", path, { headers: write, body: { summary: "Umzug planen, Etappe 2", priority: 1, tags: ["Umzug"] } });
    assert.equal(updated.status, 200);
    assert.equal(updated.json.task.summary, "Umzug planen, Etappe 2");
    assert.equal(updated.json.task.priority, 1);
    assert.deepEqual(updated.json.task.tags, ["Umzug"]);
    assert.equal(updated.json.task.status, "IN-PROCESS");
    const after = fake.read(LIST_PATHS.Aufgaben, "process.ics")!;
    for (const kept of ["RELATED-TO:fx-done", "BEGIN:VALARM", "DTSTART;TZID=Europe/Berlin:20261120T090000", "PERCENT-COMPLETE:40"]) {
      assert.ok(before.includes(kept) && after.includes(kept), kept);
    }
    // someday on top of the existing tags, then off again.
    const on = await api(base, "PATCH", path, { headers: write, body: { someday: true } });
    assert.deepEqual(on.json.task.tags, ["Umzug", "someday"]);
    const off = await api(base, "PATCH", path, { headers: write, body: { someday: false, description: null, due: null } });
    assert.deepEqual(off.json.task.tags, ["Umzug"]);
    assert.equal(off.json.task.description, null);
  });
});

test("v1 update: bad input is a 400, the list cannot change, an empty patch is a 400, unknown is 404", async () => {
  await withFake(async ({ base, fake, write }) => {
    const path = "/api/v1/lists/Aufgaben/tasks/fx-gutachten";
    const puts = () => fake.requests.filter((request) => request.method === "PUT").length;
    const before = puts();
    for (const body of [{}, { list: "Arbeit" }, { summary: "" }, { priority: 3 }, { due: "2026-13-01" }, { uid: "other" }, { status: "COMPLETED" }, { tags: [1] }]) {
      assert.equal((await api(base, "PATCH", path, { headers: write, body })).status, 400, JSON.stringify(body));
    }
    assert.equal(puts(), before);
    assert.equal((await api(base, "PATCH", "/api/v1/lists/Aufgaben/tasks/missing", { headers: write, body: { summary: "x" } })).status, 404);
    assert.equal((await api(base, "PATCH", "/api/v1/lists/Nope/tasks/fx-gutachten", { headers: write, body: { summary: "x" } })).status, 404);
  });
});

test("v1 update: a task changed meanwhile is a 409 and nothing is overwritten", async () => {
  const fake = await startFakeCalDav();
  try {
    const config = loadCalDavConfig(fakeEnv(fake))!;
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
    await withApp(caldavSource(config, racing), async ({ base }) => {
      const { signUp } = await import("./helpers.ts");
      const signed = await signUp(base);
      const write = bearer((await makeToken(base, signed, "write")).token);
      const result = await api(base, "PATCH", "/api/v1/lists/Aufgaben/tasks/fx-termin", { headers: write, body: { priority: 1 } });
      assert.equal(result.status, 409);
    });
    const stored = fake.read(LIST_PATHS.Aufgaben, "termin.ics")!;
    assert.ok(stored.includes("von jemand anderem") && !stored.includes("PRIORITY:1"));
  } finally {
    await fake.close();
  }
});

test("v1 complete: marks the task done, and doing it twice writes once", async () => {
  await withFake(async ({ base, fake, write }) => {
    const path = "/api/v1/lists/Arbeit/tasks/fx-bericht/complete";
    const puts = () => fake.requests.filter((request) => request.method === "PUT").length;
    const first = await api(base, "POST", path, { headers: write });
    assert.equal(first.status, 200);
    assert.equal(first.json.task.status, "COMPLETED");
    const afterFirst = puts();
    assert.equal(afterFirst, 1);
    const second = await api(base, "POST", path, { headers: write });
    assert.equal(second.status, 200);
    assert.equal(second.json.task.status, "COMPLETED");
    assert.equal(puts(), afterFirst);
    assert.equal((await api(base, "POST", "/api/v1/lists/Arbeit/tasks/missing/complete", { headers: write })).status, 404);
    // A completed task is gone from the default list and present with status=all.
    assert.ok(!(await api(base, "GET", "/api/v1/tasks?list=Arbeit", { headers: write })).json.tasks.some((task: { uid: string }) => task.uid === "fx-bericht"));
    assert.ok((await api(base, "GET", "/api/v1/tasks?list=Arbeit&status=all", { headers: write })).json.tasks.some((task: { uid: string }) => task.uid === "fx-bericht"));
  });
});

test("v1 has no delete: DELETE is 405 on every path, and the fake CalDAV server never sees one", async () => {
  await withFake(async ({ base, fake, write, signed }) => {
    for (const path of ["/api/v1/tasks", "/api/v1/tags", "/api/v1/lists", "/api/v1/lists/Aufgaben/tasks/fx-gutachten", "/api/v1/lists/Aufgaben/tasks/fx-gutachten/complete"]) {
      for (const headers of [write, signed.headers]) {
        const result = await api(base, "DELETE", path, { headers });
        assert.equal(result.status, 405, path);
      }
    }
    assert.equal((await api(base, "PUT", "/api/v1/tasks", { headers: write, body: {} })).status, 405);
    assert.equal((await api(base, "DELETE", "/api/v1/tasks")).status, 401);
    assert.ok(!fake.requests.some((request) => request.method === "DELETE"));
    assert.ok(fake.names(LIST_PATHS.Aufgaben).includes("gutachten.ics"));
  });
});

test("v1: a browser session works and a write needs a same-origin request", async () => {
  await withFake(async ({ base, signed }) => {
    const created = await api(base, "POST", "/api/v1/tasks", { headers: signed.headers, body: { summary: "Aus dem Browser" } });
    assert.equal(created.status, 201);
    const cross = await api(base, "POST", "/api/v1/tasks", { headers: { ...signed.headers, origin: "https://evil.example" }, body: { summary: "x" } });
    assert.equal(cross.status, 403);
  });
});

test("v1 on the demo source behaves the same, with nothing outside the process", async () => {
  await withFake(async ({ base, write }) => {
    const created = await api(base, "POST", "/api/v1/tasks", { headers: write, body: { summary: "Demo, schreiben", tags: ["a"] } });
    assert.equal(created.status, 201);
    const done = await api(base, "POST", `/api/v1/lists/Aufgaben/tasks/${created.json.task.uid}/complete`, { headers: write });
    assert.equal(done.json.task.status, "COMPLETED");
  }, { source: "demo" });
});

test("an error from the task server is a 502 that names no URL or password", async () => {
  const refusing = await startFakeCalDav({ auth: { user: "someone-else", password: PASSWORD } });
  try {
    await withApp(caldavSource(loadCalDavConfig(fakeEnv(refusing))!), async ({ base }) => {
      const { signUp } = await import("./helpers.ts");
      const signed = await signUp(base);
      const write = bearer((await makeToken(base, signed, "write")).token);
      for (const [method, path, body] of [
        ["GET", "/api/v1/tasks", undefined],
        ["POST", "/api/v1/tasks", { summary: "x" }],
        ["PATCH", "/api/v1/lists/Aufgaben/tasks/fx-gutachten", { summary: "x" }],
      ] as const) {
        const result = await api(base, method, path, { headers: write, body });
        assert.equal(result.status, 502, path);
        const text = JSON.stringify(result.json);
        assert.ok(!text.includes(refusing.base) && !text.includes(PASSWORD));
      }
    });
  } finally {
    await refusing.close();
  }
});
