import assert from "node:assert/strict";
import test from "node:test";
import { CalDavClient } from "../src/caldav/client.ts";
import { loadCalDavConfig } from "../src/caldav/config.ts";
import { caldavSource } from "../src/caldav/source.ts";
import { fakeEnv, LIST_PATHS, PASSWORD, startFakeCalDav, USER, type FakeCalDav } from "./fake-caldav.ts";
import { makeToken, signUp, withApp, type Signed } from "./helpers.ts";

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method?: string; params?: unknown; result?: unknown };

async function post(base: string, headers: Record<string, string>, body: unknown, raw = false) {
  const response = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, response, text, json: text ? (JSON.parse(text) as any) : undefined };
}

const call = (id: number, name: string, args: unknown = {}): Rpc => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const toolJson = (result: any) => JSON.parse(result.json.result.content[0].text);

async function withMcp(
  fn: (ctx: { base: string; fake: FakeCalDav; signed: Signed; read: Record<string, string>; write: Record<string, string> }) => Promise<void>,
) {
  const fake = await startFakeCalDav();
  try {
    const client = new CalDavClient({ base: fake.base, user: USER, password: PASSWORD });
    await withApp(caldavSource(loadCalDavConfig(fakeEnv(fake))!, client), async ({ base }) => {
      const signed = await signUp(base);
      const read = { authorization: `Bearer ${(await makeToken(base, signed, "read")).token}` };
      const write = { authorization: `Bearer ${(await makeToken(base, signed, "write")).token}` };
      await fn({ base, fake, signed, read, write });
    });
  } finally {
    await fake.close();
  }
}

test("initialize answers with the protocol version, tools capability and server info", async () => {
  await withMcp(async ({ base, read }) => {
    const result = await post(base, read, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    assert.equal(result.status, 200);
    assert.equal(result.json.jsonrpc, "2.0");
    assert.equal(result.json.id, 1);
    assert.equal(result.json.result.protocolVersion, "2025-06-18");
    assert.deepEqual(result.json.result.capabilities, { tools: {} });
    assert.deepEqual(result.json.result.serverInfo, { name: "bujo", version: "0.1.0" });
    assert.match(result.response.headers.get("content-type") ?? "", /application\/json/);
  });
});

test("notifications and ping: a notification is 202 with no body, ping is an empty result", async () => {
  await withMcp(async ({ base, read }) => {
    const note = await post(base, read, { jsonrpc: "2.0", method: "notifications/initialized" });
    assert.equal(note.status, 202);
    assert.equal(note.text, "");
    assert.equal((await post(base, read, { jsonrpc: "2.0", id: 3, result: {} })).status, 202, "a client response");
    const ping = await post(base, read, { jsonrpc: "2.0", id: "p", method: "ping" });
    assert.deepEqual(ping.json, { jsonrpc: "2.0", id: "p", result: {} });
  });
});

test("tools/list names all seven tools with read-only hints and strict schemas", async () => {
  await withMcp(async ({ base, read }) => {
    const result = await post(base, read, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    const tools = result.json.result.tools as Array<{ name: string; annotations: { readOnlyHint: boolean }; inputSchema: { type: string; additionalProperties: boolean } }>;
    assert.deepEqual(tools.map((tool) => tool.name), ["list_tasks", "get_task", "list_tags", "list_lists", "create_task", "update_task", "complete_task"]);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(tool.inputSchema.additionalProperties, false);
    }
    assert.deepEqual(tools.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name), ["list_tasks", "get_task", "list_tags", "list_lists"]);
    assert.ok(!tools.some((tool) => /delete|remove/i.test(tool.name)));
  });
});

test("a read tool call returns the task list as JSON text", async () => {
  await withMcp(async ({ base, read }) => {
    const tasks = await post(base, read, call(4, "list_tasks", { list: "Arbeit" }));
    assert.equal(tasks.json.result.isError, false);
    assert.equal(tasks.json.result.content[0].type, "text");
    assert.deepEqual(toolJson(tasks).tasks.map((task: { uid: string }) => task.uid), ["fx-bericht"]);
    assert.equal(toolJson(await post(base, read, call(5, "get_task", { uid: "fx-gutachten", list: "Aufgaben" }))).task.summary, "Gutachten lesen, kommentieren; abgeben");
    assert.equal(toolJson(await post(base, read, call(6, "list_lists"))).lists.length, 2);
    assert.ok(toolJson(await post(base, read, call(7, "list_tags"))).tags.some((item: { tag: string }) => item.tag === "Haushalt"));
  });
});

test("a write tool call changes the fake CalDAV store: create, update, complete", async () => {
  await withMcp(async ({ base, fake, write }) => {
    const created = toolJson(await post(base, write, call(8, "create_task", { summary: "Per MCP, mit Komma", tags: ["agent"], due: "2026-12-24", priority: 1 }))).task;
    assert.equal(created.summary, "Per MCP, mit Komma");
    assert.ok(fake.names(LIST_PATHS.Aufgaben).includes(`${created.uid}.ics`));
    const updated = toolJson(await post(base, write, call(9, "update_task", { uid: created.uid, summary: "Neu", someday: true }))).task;
    assert.equal(updated.summary, "Neu");
    assert.deepEqual(updated.tags, ["agent", "someday"]);
    const done = toolJson(await post(base, write, call(10, "complete_task", { uid: created.uid }))).task;
    assert.equal(done.status, "COMPLETED");
    assert.ok(!fake.requests.some((request) => request.method === "DELETE"));
  });
});

test("a read token calling a write tool gets a tool error and nothing is written", async () => {
  await withMcp(async ({ base, fake, read }) => {
    for (const [name, args] of [["create_task", { summary: "x" }], ["update_task", { uid: "fx-gutachten", summary: "x" }], ["complete_task", { uid: "fx-gutachten" }]] as const) {
      const result = await post(base, read, call(11, name, args));
      assert.equal(result.status, 200);
      assert.equal(result.json.result.isError, true);
      assert.match(result.json.result.content[0].text, /read only/);
    }
    assert.ok(!fake.requests.some((request) => request.method === "PUT"));
  });
});

test("validation, unknown task and server errors come back as tool errors", async () => {
  await withMcp(async ({ base, write }) => {
    const cases: Array<[string, unknown, RegExp]> = [
      ["create_task", {}, /summary/],
      ["create_task", { summary: "x", due: "nope" }, /due/],
      ["create_task", { summary: "x", extra: 1 }, /unknown field/],
      ["update_task", { uid: "fx-gutachten" }, /nothing to change/],
      ["update_task", { uid: "missing", summary: "x" }, /not found/],
      ["get_task", { uid: "missing" }, /not found/],
      ["complete_task", { uid: "missing" }, /not found/],
      ["list_tasks", { list: "Nope" }, /unknown list/],
      ["list_lists", { x: 1 }, /no arguments/],
    ];
    for (const [name, args, pattern] of cases) {
      const result = await post(base, write, call(12, name, args));
      assert.equal(result.status, 200, name);
      assert.equal(result.json.result.isError, true, `${name} ${JSON.stringify(args)}`);
      assert.match(result.json.result.content[0].text, pattern);
    }
  });
});

test("protocol errors: unknown method, unknown tool, bad params, bad JSON, batch", async () => {
  await withMcp(async ({ base, read }) => {
    assert.equal((await post(base, read, { jsonrpc: "2.0", id: 1, method: "resources/list" })).json.error.code, -32601);
    assert.equal((await post(base, read, call(2, "delete_task", { uid: "x" }))).json.error.code, -32602);
    assert.equal((await post(base, read, { jsonrpc: "2.0", id: 3, method: "tools/call", params: {} })).json.error.code, -32602);
    assert.equal((await post(base, read, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_tasks", arguments: [] } })).json.error.code, -32602);
    assert.equal((await post(base, read, { id: 5, method: "ping" })).json.error.code, -32600);
    const bad = await post(base, read, "{nope", true);
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, -32700);
    const batch = await post(base, read, [{ jsonrpc: "2.0", id: 1, method: "ping" }]);
    assert.equal(batch.status, 400);
    assert.equal(batch.json.error.code, -32600);
  });
});

test("only POST: GET and DELETE are 405 with Allow: POST", async () => {
  await withMcp(async ({ base, read }) => {
    for (const method of ["GET", "DELETE", "PUT"]) {
      const response = await fetch(`${base}/mcp`, { method, headers: read });
      assert.equal(response.status, 405, method);
      assert.equal(response.headers.get("allow"), "POST");
    }
  });
});

test("auth: no token, a bad token and a browser cookie are all refused", async () => {
  await withMcp(async ({ base, signed }) => {
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    assert.equal((await post(base, {}, ping)).status, 401);
    assert.equal((await post(base, { authorization: `Bearer bujo_${"A".repeat(43)}` }, ping)).status, 401);
    assert.equal((await post(base, signed.headers, ping)).status, 401, "a session cookie is not an agent token");
  });
});

test("a revoked token stops working on /mcp at once", async () => {
  await withMcp(async ({ base, signed }) => {
    const made = await makeToken(base, signed, "write", "short lived");
    const headers = { authorization: `Bearer ${made.token}` };
    assert.equal((await post(base, headers, { jsonrpc: "2.0", id: 1, method: "ping" })).status, 200);
    await fetch(`${base}/api/tokens/${made.id}/revoke`, { method: "POST", headers: signed.headers });
    assert.equal((await post(base, headers, { jsonrpc: "2.0", id: 2, method: "ping" })).status, 401);
  });
});

test("a foreign Origin is refused, a matching or missing one is fine", async () => {
  await withMcp(async ({ base, read }) => {
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    assert.equal((await post(base, { ...read, origin: "https://evil.example" }, ping)).status, 403);
    assert.equal((await post(base, { ...read, origin: base }, ping)).status, 200);
    assert.equal((await post(base, read, ping)).status, 200);
  });
});

test("a body over the limit is 413", async () => {
  await withMcp(async ({ base, read }) => {
    const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70 * 1024) } });
    assert.equal((await post(base, read, big, true)).status, 413);
  });
});
