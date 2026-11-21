import { CalDavError, type CalDavClient, type CalDavList, type CalendarResource } from "../caldav/client.ts";
import { editTodo, TodoNotFoundError } from "../caldav/ics.ts";
import { editEvent, parseVEvents, type EventFields } from "../caldav/vevent.ts";
import type { Entry, RemoteLink } from "../log/types.ts";
import {
  eventFieldsFor,
  eventReadBackMismatch,
  newEventFor,
  newTodoFor,
  patchFor,
  readBackMismatch,
  syncKind,
  todoShape,
  type SyncKind,
} from "./mapping.ts";
import { messagesFor, NOT_OURS_MESSAGE, statusMessage, type MessageKind } from "./strings.ts";

export type PushDeps = {
  client: CalDavClient;
  /** The task list for a VTODO push, the event calendar for a VEVENT push. */
  list: CalDavList;
  /** The event calendar, when there is one. A task push never reuses a link that points into it. */
  eventCalendar?: CalDavList | null;
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

/** What differs between the two kinds of object: how to write one, edit one, and check one that was read back. */
type Plan = {
  kind: MessageKind;
  /** The text of a new object with this UID. */
  create(uid: string, nowMs: number): string;
  /** The edited text of an existing object, or null when it has no such component. Throws for a VTODO that is not there. */
  edit(text: string, uid: string, nowMs: number): { ics: string; changed: boolean } | null;
  /** Null when the object says what was meant to be written, else what differs. */
  mismatch(text: string, uid: string): string | null;
  /** A reason to leave an existing object alone (it is not ours), or null. */
  foreign(text: string, uid: string): string | null;
};

/** The plan for a VTODO: the part of the entry the task sync owns. */
function todoPlan(entry: Entry): Plan {
  const shape = todoShape(entry);
  return {
    kind: "todo",
    create: (uid, nowMs) => newTodoFor(shape, uid, nowMs),
    edit: (text, uid, nowMs) => editTodo(text, uid, patchFor(shape), nowMs),
    mismatch: (text, uid) => readBackMismatch(text, uid, shape),
    foreign: () => null,
  };
}

/** The plan for a VEVENT: id, title, day, time and tags. */
function eventPlan(entry: Entry): Plan {
  const fields = eventFieldsFor(entry);
  return {
    kind: "event",
    create: (uid, nowMs) => newEventFor(fields, uid, nowMs),
    edit: (text, uid, nowMs) => editEvent(text, uid, fields, nowMs),
    mismatch: (text, uid) => eventReadBackMismatch(text, uid, fields),
    foreign: (text, uid) => notOurs(text, uid, fields),
  };
}

/** The reason to refuse an edit: the VEVENT is there but has no X-BUJO-ID, or the id of another entry. Null when it is ours or absent. */
function notOurs(text: string, uid: string, fields: EventFields): string | null {
  const block = parseVEvents(text).find((item) => item.uid === uid);
  if (!block) return null;
  return block.entryId === fields.entryId ? null : "event has no matching X-BUJO-ID";
}

/** Compares a calendar object with what was meant to be written. Throws SyncFailure on a difference. */
function verify(plan: Plan, link: RemoteLink, resource: CalendarResource): RemoteLink {
  const checked = { ...link, etag: resource.etag ?? link.etag };
  const mismatch = plan.mismatch(resource.text, link.uid);
  if (mismatch) throw new SyncFailure(messagesFor(plan.kind).readBackMismatch, checked, mismatch);
  return checked;
}

/** GETs the object back and checks it. A failed GET keeps the link, because the PUT before it did succeed. */
async function readBack(deps: PushDeps, plan: Plan, link: RemoteLink): Promise<RemoteLink> {
  let resource: CalendarResource;
  try {
    resource = await deps.client.getResource(link.href);
  } catch (error) {
    const failure = describeFailure(error, plan.kind);
    throw new SyncFailure(failure.shown, link, failure.message);
  }
  return verify(plan, link, resource);
}

/** A new object with a fresh UID: PUT with If-None-Match: *, then read back. */
async function createRemote(deps: PushDeps, plan: Plan): Promise<RemoteLink> {
  const uid = deps.uuid();
  const written = await deps.client.putNew(deps.list.path, uid, plan.create(uid, deps.now()));
  return await readBack(deps, plan, { href: written.href, uid, etag: written.etag });
}

/** An existing object: fetch it, patch only what the entry owns, PUT with If-Match, then read back. */
async function updateRemote(deps: PushDeps, plan: Plan, link: RemoteLink): Promise<RemoteLink> {
  const current = await deps.client.getResource(link.href);
  const foreign = plan.foreign(current.text, link.uid);
  if (foreign) throw new SyncFailure(NOT_OURS_MESSAGE, undefined, foreign);
  const edited = plan.edit(current.text, link.uid, deps.now());
  if (!edited) throw new SyncFailure(messagesFor(plan.kind).gone);
  if (!edited.changed) return verify(plan, link, current);
  const written = await deps.client.putExisting(link.href, edited.ics, current.etag ?? link.etag ?? "");
  return await readBack(deps, plan, { ...link, etag: written.etag ?? current.etag });
}

/** True when this resource href lies inside the collection at this path. */
function insideCollection(client: CalDavClient, href: string, collectionPath: string): boolean {
  const collection = client.collectionUrl(collectionPath);
  if (!collection.pathname.endsWith("/")) collection.pathname += "/";
  const resource = client.resourceUrl(href);
  return resource.origin === collection.origin && resource.pathname.startsWith(collection.pathname);
}

/** The link to update, or undefined when the stored one is for the other kind of object and must not be reused. */
function usableLink(deps: PushDeps, kind: SyncKind, link: RemoteLink | undefined): RemoteLink | undefined {
  if (!link) return undefined;
  if (kind === "event") return insideCollection(deps.client, link.href, deps.list.path) ? link : undefined;
  const other = deps.eventCalendar;
  return other && insideCollection(deps.client, link.href, other.path) ? undefined : link;
}

/**
 * Looks for a calendar object that bujo already wrote for this entry: a VEVENT whose X-BUJO-ID is the entry id.
 * An event with no X-BUJO-ID is never a match, so one that is not ours is never touched.
 */
async function findEventLink(deps: PushDeps, entryId: string): Promise<RemoteLink | undefined> {
  for (const object of await deps.client.queryEvents(deps.list.path)) {
    const found = parseVEvents(object.data).find((event) => event.entryId === entryId);
    if (found) return { href: object.href, uid: found.uid, etag: object.etag };
  }
  return undefined;
}

/** The link an event push starts from: the stored one, else one found by X-BUJO-ID, else none (a create). */
async function startingLink(deps: PushDeps, entry: Entry, link: RemoteLink | undefined): Promise<RemoteLink | undefined> {
  const usable = usableLink(deps, "event", link);
  return usable ?? (await findEventLink(deps, entry.id));
}

/** Pushes one entry: creates its VTODO or VEVENT the first time, updates it after. Returns the link to store. */
export async function pushEntry(deps: PushDeps, entry: Entry, link: RemoteLink | undefined): Promise<RemoteLink> {
  const kind = syncKind(entry.type);
  if (!kind) throw new SyncFailure(messagesFor("todo").unexpected, undefined, "type does not sync");
  const plan = kind === "event" ? eventPlan(entry) : todoPlan(entry);
  try {
    const start = kind === "event" ? await startingLink(deps, entry, link) : usableLink(deps, kind, link);
    return start ? await updateRemote(deps, plan, start) : await createRemote(deps, plan);
  } catch (error) {
    throw describeFailure(error, plan.kind);
  }
}

/** Turns anything a push can throw into a SyncFailure with a message that is safe to show. */
export function describeFailure(error: unknown, kind: MessageKind = "todo"): SyncFailure {
  const messages = messagesFor(kind);
  if (error instanceof SyncFailure) return error;
  if (error instanceof TodoNotFoundError) return new SyncFailure(messages.gone);
  if (error instanceof CalDavError) return new SyncFailure(caldavMessage(error, kind), undefined, `status ${error.status ?? "none"}`);
  return new SyncFailure(messages.unexpected, undefined, error instanceof Error ? error.name : "unknown");
}

function caldavMessage(error: CalDavError, kind: MessageKind): string {
  const messages = messagesFor(kind);
  if (error.status === 412) return messages.conflict;
  if (error.status === 404) return messages.gone;
  if (error.status === 401 || error.status === 403) return messages.refused;
  if (error.status === null) return messages.unreachable;
  return statusMessage(error.status);
}
