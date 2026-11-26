import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Plugin = { manifest: Record<string, unknown>; activate?: (api: Api) => void; deactivate?: () => void };
type Api = { id: string; permissions: string[]; storage: { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void } };
type Registry = {
  register(p: Plugin): void;
  setEnabled(id: string, on: boolean): void;
  isEnabled(id: string): boolean;
  list(): Array<{ manifest: { id: string }; enabled: boolean }>;
  contributions(kind: string): Array<{ id: string; pluginId: string }>;
  command(id: string): { id: string } | null;
  onChange(fn: (e: { type: string; id: string; enabled: boolean }) => void): () => void;
};
type Plugins = { create(backend: unknown): Registry; manifest: { problems(m: unknown): string[] } };

/** The real plugin scripts in a page-like sandbox over one shared fake localStorage. */
function load(data = new Map<string, string>()): { plugins: Plugins; backend: Record<string, unknown>; data: Map<string, string> } {
  const backend = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
  const window: { BujoPlugins?: Plugins; localStorage: typeof backend } = { localStorage: backend };
  const context = vm.createContext({ window, JSON, Object, Array, String, Math, Error });
  for (const file of ["manifest", "storage", "registry"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/plugins/${file}.js`, import.meta.url), "utf8"), context);
  }
  return { plugins: window.BujoPlugins!, backend, data };
}

/** Copies a value out of the sandbox realm so deepEqual compares plain host arrays. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const run = () => undefined;
function plugin(id: string, extra: Record<string, unknown> = {}): Plugin {
  return {
    manifest: {
      id, name: id, version: 1, description: "A plugin", permissions: [],
      contributes: { commands: [{ id: `${id}.go`, title: "Go", run }], views: [{ id: `${id}.view` }] },
      ...extra,
    },
  };
}

test("a good manifest registers, and is on by default", () => {
  const { plugins, backend } = load();
  const registry = plugins.create(backend);
  registry.register(plugin("test.one"));
  assert.equal(registry.isEnabled("test.one"), true);
  assert.deepEqual(plain(registry.list()).map((p) => [p.manifest.id, p.enabled]), [["test.one", true]]);
});

test("bad manifests are refused at register time", () => {
  const { plugins, backend } = load();
  const registry = plugins.create(backend);
  const bad: Array<Record<string, unknown>> = [
    { id: "Nope" }, { name: "" }, { version: 0 }, { version: 1.5 }, { description: "" }, { permissions: "network" },
    { permissions: ["root"] }, { contributes: undefined }, { contributes: { widgets: [] } },
    { contributes: { commands: [{ id: "x" }] } }, { contributes: { views: [{ id: "a" }, { id: "a" }] } },
    { contributes: { views: [{}] } }, { contributes: { renderers: {} } },
  ];
  for (const extra of bad) assert.throws(() => registry.register(plugin("test.bad", extra)), /Invalid plugin manifest/, JSON.stringify(extra));
  assert.throws(() => registry.register(null as unknown as Plugin), /Invalid plugin manifest/);
  assert.equal(registry.list().length, 0);
  assert.deepEqual(plain(plugins.manifest.problems(plugin("test.ok").manifest)), []);
});

test("a repeated id is refused", () => {
  const { plugins, backend } = load();
  const registry = plugins.create(backend);
  registry.register(plugin("test.one"));
  assert.throws(() => registry.register(plugin("test.one")), /already registered/);
});

test("enabled state persists across registries and fires change events", () => {
  const first = load();
  const a = first.plugins.create(first.backend);
  a.register(plugin("test.one"));
  const events: Array<[string, boolean]> = [];
  const stop = a.onChange((e) => events.push([e.id, e.enabled]));
  a.setEnabled("test.one", false);
  stop();
  a.setEnabled("test.one", true);
  a.setEnabled("test.one", false);
  assert.deepEqual(events, [["test.one", false]]);

  const second = load(first.data);
  const b = second.plugins.create(second.backend);
  b.register(plugin("test.one"));
  assert.equal(b.isEnabled("test.one"), false);
  assert.throws(() => b.setEnabled("test.nope", true), /Unknown plugin/);
  assert.equal(b.isEnabled("test.nope"), false);
});

test("contributions and commands come only from enabled plugins", () => {
  const { plugins, backend } = load();
  const registry = plugins.create(backend);
  registry.register(plugin("test.one"));
  registry.register(plugin("test.two"));
  assert.deepEqual(plain(registry.contributions("commands").map((c) => [c.id, c.pluginId].join(" "))), ["test.one.go test.one", "test.two.go test.two"]);
  assert.equal(registry.contributions("scanParsers").length, 0);
  registry.setEnabled("test.one", false);
  assert.deepEqual(plain(registry.contributions("views").map((c) => c.id)), ["test.two.view"]);
  assert.equal(registry.command("test.one.go"), null);
  assert.equal(registry.command("test.two.go")?.id, "test.two.go");
  registry.setEnabled("test.one", true);
  assert.equal(registry.command("test.one.go")?.id, "test.one.go");
});

test("activate runs when on, deactivate when switched off, and the api has only id, permissions and storage", () => {
  const { plugins, backend } = load();
  const registry = plugins.create(backend);
  const log: string[] = [];
  let api!: Api;
  registry.register({ ...plugin("test.one"), activate: (a) => { api = a; log.push("on"); }, deactivate: () => log.push("off") });
  registry.setEnabled("test.one", false);
  registry.setEnabled("test.one", true);
  assert.deepEqual(log, ["on", "off", "on"]);
  assert.deepEqual(plain(Object.keys(api).sort()), ["id", "permissions", "storage"]);
});

test("plugin storage is namespaced: a plugin cannot read another plugin's keys or the app's", () => {
  const { plugins, backend, data } = load();
  const registry = plugins.create(backend);
  const apis: Record<string, Api> = {};
  for (const id of ["test.a", "test.a.b"]) registry.register({ ...plugin(id), activate: (api) => { apis[id] = api; } });
  data.set("bujo.secret", "app");
  apis["test.a"].storage.set("b:k", "from a");
  apis["test.a.b"].storage.set("k", "from ab");
  assert.equal(apis["test.a.b"].storage.get("k"), "from ab");
  assert.equal(apis["test.a"].storage.get("k"), null);
  assert.equal(apis["test.a"].storage.get("b:k"), "from a");
  assert.equal(apis["test.a"].storage.get("bujo.secret"), null);
  assert.equal(apis["test.a"].storage.get("../bujo.secret"), null);
  apis["test.a"].storage.remove("b:k");
  assert.equal(apis["test.a.b"].storage.get("k"), "from ab");
  assert.deepEqual([...data.keys()].filter((k) => k.startsWith("bujo.plugin.")).sort(), ["bujo.plugin.test.a.b:k"]);
});

test("a blocked store does not throw", () => {
  const { plugins } = load();
  const blocked = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); }, removeItem: () => { throw new Error("x"); } };
  const registry = plugins.create(blocked);
  registry.register(plugin("test.one"));
  registry.setEnabled("test.one", false);
  assert.equal(registry.isEnabled("test.one"), true);
});
