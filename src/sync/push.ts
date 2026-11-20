import { CalDavError, type CalDavClient, type CalDavList, type CalendarResource } from "../caldav/client.ts";
import { editTodo, TodoNotFoundError } from "../caldav/ics.ts";
import type { Entry, RemoteLink } from "../log/types.ts";
import { newTodoFor, patchFor, readBackMismatch, todoShape, type TodoShape } from "./mapping.ts";
import { statusMessage, SYNC_MESSAGES } from "./strings.ts";

export type PushDeps = {
  client: CalDavClient;
  list: CalDavList;
  now: () => number;
  uuid: () => string;
};

/**
 * A push that did not end well. `shown` is safe to put on the entry. `detail` is for the server log only.
 * `link` is set when the object was written but could not be confirmed, so a retry updates that object
 * instead of creating a second one.
 */
export class SyncFailure extends Error {
  readonly shown: string;
  readonly link: RemoteLink | undefined;
  constructor(shown: string, link?: RemoteLink, detail?: string) {
    super(detail ? `${shown} (${detail})` : shown);
    this.name = "SyncFailure";
    this.shown = shown;
    this.link = link;
  }
}

/** Compares a calendar object with what was meant to be written. Throws SyncFailure on a difference. */
function verify(shape: TodoShape, link: RemoteLink, resource: CalendarResource): RemoteLink {
  const checked = { ...link, etag: resource.etag ?? link.etag };
  const mismatch = readBackMismatch(resource.text, link.uid, shape);
  if (mismatch) throw new SyncFailure(SYNC_MESSAGES.readBackMismatch, checked, mismatch);
  return checked;
}

/** GETs the object back and checks it. A failed GET keeps the link, because the PUT before it did succeed. */
async function readBack(deps: PushDeps, shape: TodoShape, link: RemoteLink): Promise<RemoteLink> {
  let resource: CalendarResource;
  try {
    resource = await deps.client.getResource(link.href);
  } catch (error) {
    const failure = describeFailure(error);
    throw new SyncFailure(failure.shown, link, failure.message);
  }
  return verify(shape, link, resource);
}

/** A new VTODO with a fresh UID: PUT with If-None-Match: *, then read back. */
async function createRemote(deps: PushDeps, shape: TodoShape): Promise<RemoteLink> {
  const uid = deps.uuid();
  const written = await deps.client.putNew(deps.list.path, uid, newTodoFor(shape, uid, deps.now()));
  return await readBack(deps, shape, { href: written.href, uid, etag: written.etag });
}

/** An existing VTODO: fetch it, patch only what the entry owns, PUT with If-Match, then read back. */
async function updateRemote(deps: PushDeps, shape: TodoShape, link: RemoteLink): Promise<RemoteLink> {
  const current = await deps.client.getResource(link.href);
  const edited = editTodo(current.text, link.uid, patchFor(shape), deps.now());
  if (!edited.changed) return verify(shape, link, current);
  const written = await deps.client.putExisting(link.href, edited.ics, current.etag ?? link.etag ?? "");
  return await readBack(deps, shape, { ...link, etag: written.etag ?? current.etag });
}

/** Pushes one entry: creates its VTODO the first time, updates it after. Returns the link to store. */
export async function pushEntry(deps: PushDeps, entry: Entry, link: RemoteLink | undefined): Promise<RemoteLink> {
  const shape = todoShape(entry);
  try {
    return link ? await updateRemote(deps, shape, link) : await createRemote(deps, shape);
  } catch (error) {
    throw describeFailure(error);
  }
}

/** Turns anything a push can throw into a SyncFailure with a message that is safe to show. */
export function describeFailure(error: unknown): SyncFailure {
  if (error instanceof SyncFailure) return error;
  if (error instanceof TodoNotFoundError) return new SyncFailure(SYNC_MESSAGES.gone);
  if (error instanceof CalDavError) return new SyncFailure(caldavMessage(error), undefined, `status ${error.status ?? "none"}`);
  return new SyncFailure(SYNC_MESSAGES.unexpected, undefined, error instanceof Error ? error.name : "unknown");
}

function caldavMessage(error: CalDavError): string {
  if (error.status === 412) return SYNC_MESSAGES.conflict;
  if (error.status === 404) return SYNC_MESSAGES.gone;
  if (error.status === 401 || error.status === 403) return SYNC_MESSAGES.refused;
  if (error.status === null) return SYNC_MESSAGES.unreachable;
  return statusMessage(error.status);
}
