import { completeTask, createTask, getTask, listLists, listTags, listTasks, updateTask } from "../api/tasks.ts";
import { HttpError, readJson, sendJson } from "../app-kit/http.ts";
import { isRead, requirePrincipal, type RouteContext } from "./context.ts";

/** Task bodies may hold a long description, so this is larger than the kit's 16 KiB default. */
export const API_BODY_MAX = 64 * 1024;

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw new HttpError(404, "not found");
  }
}

function query(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of url.searchParams) {
    if (key in out) throw new HttpError(400, `${key} was given twice`);
    out[key] = value;
  }
  return out;
}

function methodNotAllowed(allow: string): never {
  throw new HttpError(405, `method not allowed (use ${allow})`);
}

/**
 * /api/v1/*. A browser session or an agent token may call it. A read token may only GET.
 * There is no DELETE route: a DELETE gets 405 on every path.
 */
export async function handleApiV1(ctx: RouteContext): Promise<boolean> {
  const { req, res, url, method, pathname, source, who } = ctx;
  if (pathname !== "/api/v1" && !pathname.startsWith("/api/v1/")) return false;

  const principal = requirePrincipal(who);
  const read = isRead(method);
  if (!read && principal.kind === "agent" && principal.token.scope !== "write") {
    throw new HttpError(403, "this token is read only");
  }
  const segments = pathname.slice("/api/v1".length).split("/").filter(Boolean).map(decode);

  if (segments.length === 1 && segments[0] === "lists") {
    if (!read) methodNotAllowed("GET");
    sendJson(res, 200, listLists(source));
    return true;
  }

  if (segments.length === 1 && segments[0] === "tags") {
    if (!read) methodNotAllowed("GET");
    sendJson(res, 200, await listTags(source, query(url)));
    return true;
  }

  if (segments.length === 1 && segments[0] === "tasks") {
    if (read) {
      sendJson(res, 200, await listTasks(source, query(url)));
      return true;
    }
    if (method !== "POST") methodNotAllowed("GET, POST");
    sendJson(res, 201, await createTask(source, await readJson(req, { max: API_BODY_MAX })));
    return true;
  }

  // /lists/:list/tasks/:uid and /lists/:list/tasks/:uid/complete
  if (segments[0] === "lists" && segments[2] === "tasks" && segments.length >= 4 && segments.length <= 5) {
    const [, list, , uid, action] = segments;
    if (segments.length === 4) {
      if (read) {
        sendJson(res, 200, await getTask(source, list, uid));
        return true;
      }
      if (method !== "PATCH") methodNotAllowed("GET, PATCH");
      sendJson(res, 200, await updateTask(source, list, uid, await readJson(req, { max: API_BODY_MAX })));
      return true;
    }
    if (action === "complete") {
      if (method !== "POST") methodNotAllowed("POST");
      sendJson(res, 200, await completeTask(source, list, uid));
      return true;
    }
  }

  throw new HttpError(404, "not found");
}
