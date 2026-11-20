import { completeTask, createTask, getTask, listLists, listTags, listTasks, updateTask } from "../api/tasks.ts";
import { HttpError } from "../app-kit/http.ts";
import type { TaskSource } from "../caldav/source.ts";

/**
 * A small MCP server over plain JSON-RPC 2.0, Streamable HTTP, POST only.
 * No SDK: the protocol surface bujo needs is initialize, ping, tools/list and tools/call.
 * The tools call the same functions as /api/v1, so validation and errors are shared.
 */

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "bujo", version: "0.1.0" };

export type Scope = "read" | "write";
export type JsonRpcId = string | number | null;

export type McpResult =
  | { kind: "response"; body: unknown }
  /** A notification or a client response: accepted, no body. */
  | { kind: "accepted" };

type Tool = {
  name: string;
  title: string;
  description: string;
  readOnly: boolean;
  inputSchema: Record<string, unknown>;
  run(source: TaskSource, args: Record<string, unknown>): Promise<unknown> | unknown;
};

const LIST_PROP = { type: "string", description: "List name, for example Aufgaben or Arbeit. Defaults to Aufgaben." };
const TAGS_PROP = { type: "array", items: { type: "string", maxLength: 60 }, maxItems: 20, description: "Tags, as a whole list." };
const FIELDS = {
  summary: { type: "string", minLength: 1, maxLength: 500, description: "One line of text." },
  description: { type: ["string", "null"], maxLength: 10000, description: "Longer notes. null removes them." },
  due: { type: ["string", "null"], description: "Due date as YYYY-MM-DD. null removes it." },
  priority: { enum: [1, 5, 9, null], description: "1 high, 5 medium, 9 low, null for none." },
  tags: TAGS_PROP,
  someday: { type: "boolean", description: "Adds or removes the someday tag." },
};

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties, required, additionalProperties: false };
}

function rest<T extends Record<string, unknown>>(args: T, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...args };
  for (const key of keys) delete copy[key];
  return copy;
}

export const TOOLS: Tool[] = [
  {
    name: "list_tasks",
    title: "List tasks",
    description: "List tasks, open ones by default, sorted by due date and priority.",
    readOnly: true,
    inputSchema: schema({
      list: LIST_PROP,
      status: { enum: ["open", "all"], description: "open (default) or all, which includes done and cancelled." },
      tag: { type: "string", description: "Only tasks with this tag." },
      priority: { enum: [1, 5, 9, "none"], description: "1 high, 5 medium, 9 low, or none for unset." },
      someday: { type: "boolean", description: "true for only someday tasks, false for none." },
      scheduled: { type: "boolean", description: "true for only tasks with a due date, false for only undated ones." },
    }),
    run: (source, args) => listTasks(source, args),
  },
  {
    name: "get_task",
    title: "Get a task",
    description: "Get one task by its id and list.",
    readOnly: true,
    inputSchema: schema({ uid: { type: "string" }, list: LIST_PROP }, ["uid"]),
    run: (source, args) => getTask(source, args.list, args.uid),
  },
  {
    name: "list_tags",
    title: "List tags",
    description: "List every tag with the number of tasks that carry it. Open tasks by default.",
    readOnly: true,
    inputSchema: schema({ list: LIST_PROP, status: { enum: ["open", "all"] } }),
    run: (source, args) => listTags(source, args),
  },
  {
    name: "list_lists",
    title: "List task lists",
    description: "List the task lists and which one is the default.",
    readOnly: true,
    inputSchema: schema({}),
    run: (source, args) => {
      if (Object.keys(args).length > 0) throw new HttpError(400, "list_lists takes no arguments");
      return listLists(source);
    },
  },
  {
    name: "create_task",
    title: "Create a task",
    description: "Create a task. Needs a write token.",
    readOnly: false,
    inputSchema: schema({ list: LIST_PROP, ...FIELDS }, ["summary"]),
    run: (source, args) => createTask(source, args),
  },
  {
    name: "update_task",
    title: "Update a task",
    description: "Change some fields of a task. Fields you leave out stay as they are. The list cannot change. Needs a write token.",
    readOnly: false,
    inputSchema: schema({ uid: { type: "string" }, list: LIST_PROP, ...FIELDS }, ["uid"]),
    run: (source, args) => updateTask(source, args.list, args.uid, rest(args, "uid", "list")),
  },
  {
    name: "complete_task",
    title: "Complete a task",
    description: "Mark a task done. Doing it again changes nothing. Needs a write token.",
    readOnly: false,
    inputSchema: schema({ uid: { type: "string" }, list: LIST_PROP }, ["uid"]),
    run: (source, args) => completeTask(source, args.list, args.uid),
  },
];

function ok(id: JsonRpcId, result: unknown): McpResult {
  return { kind: "response", body: { jsonrpc: "2.0", id, result } };
}

function fail(id: JsonRpcId, code: number, message: string): McpResult {
  return { kind: "response", body: { jsonrpc: "2.0", id, error: { code, message } } };
}

/** A tool failure is a result with isError, not a protocol error, so the model can read it and react. */
function toolError(id: JsonRpcId, message: string): McpResult {
  return ok(id, { content: [{ type: "text", text: message }], isError: true });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function listTools() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: tool.readOnly, destructiveHint: false, idempotentHint: tool.readOnly, openWorldHint: false },
  }));
}

/** Handles one parsed JSON-RPC message. Never throws: a failure becomes a JSON-RPC or tool error. */
export async function handleMessage(source: TaskSource, scope: Scope, message: unknown): Promise<McpResult> {
  if (!isObject(message) || message.jsonrpc !== "2.0") return fail(null, -32600, "invalid request");
  const hasId = "id" in message;
  const id = message.id;
  if (hasId && id !== null && typeof id !== "string" && typeof id !== "number") return fail(null, -32600, "invalid request id");

  // A response from the client to something we sent. We send nothing, so there is nothing to do.
  if (!("method" in message) && ("result" in message || "error" in message)) return { kind: "accepted" };
  if (typeof message.method !== "string") return fail(hasId ? (id as JsonRpcId) : null, -32600, "invalid request");
  const method = message.method;

  // A message with no id is a notification: accepted, never answered.
  if (!hasId) return { kind: "accepted" };
  const reqId = id as JsonRpcId;
  const params = message.params;
  if (params !== undefined && !isObject(params)) return fail(reqId, -32602, "params must be an object");

  switch (method) {
    case "initialize":
      return ok(reqId, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: "bujo is a bullet journal backlog. Read tools work with any token. Write tools need a write token. Nothing can be deleted.",
      });
    case "ping":
      return ok(reqId, {});
    case "tools/list":
      return ok(reqId, { tools: listTools() });
    case "tools/call": {
      const name = params?.name;
      if (typeof name !== "string") return fail(reqId, -32602, "tools/call needs a tool name");
      const tool = TOOLS.find((item) => item.name === name);
      if (!tool) return fail(reqId, -32602, `unknown tool: ${name.slice(0, 60)}`);
      const args = params?.arguments === undefined ? {} : params.arguments;
      if (!isObject(args)) return fail(reqId, -32602, "arguments must be an object");
      if (!tool.readOnly && scope !== "write") return toolError(reqId, "This token is read only. Create a write token to change tasks.");
      try {
        const result = await tool.run(source, args);
        return ok(reqId, { content: [{ type: "text", text: JSON.stringify(result) }], isError: false });
      } catch (error) {
        if (error instanceof HttpError) return toolError(reqId, error.message);
        console.error("mcp tool failed:", error instanceof Error ? error.name : "unknown error");
        return toolError(reqId, "internal error");
      }
    }
    default:
      return fail(reqId, -32601, `method not found: ${method.slice(0, 60)}`);
  }
}
