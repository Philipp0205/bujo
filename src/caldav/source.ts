import { randomUUID } from "node:crypto";
import { CalDavClient, CalDavError, type CalendarResource } from "./client.ts";
import type { CalDavConfig } from "./config.ts";
import { demoObjects } from "./demo.ts";
import { buildNewTodo, editTodo, isOpen, parseVTodos, TodoNotFoundError, type NewTodo, type Task, type TodoPatch } from "./ics.ts";

/** The list name is not one of the configured lists. */
export class UnknownListError extends Error {
  constructor(list: string) {
    super(`unknown list "${list}"`);
    this.name = "UnknownListError";
  }
}

/** No task with this UID in this list. */
export class TaskNotFoundError extends Error {
  constructor() {
    super("task not found");
    this.name = "TaskNotFoundError";
  }
}

/** The task changed on the server between our read and our write (HTTP 412). Nothing was written. */
export class TaskConflictError extends Error {
  constructor() {
    super("The task changed in the meantime. Reload it and try again.");
    this.name = "TaskConflictError";
  }
}

export type NewTask = Omit<NewTodo, "uid">;

/**
 * Where the backlog comes from, and where writes go. There is no delete: neither in this type nor behind it.
 * A write returns the task as read back from the store, not what we sent.
 */
export type TaskSource = {
  kind: "caldav" | "demo";
  listNames: string[];
  load(): Promise<Task[]>;
  get(list: string, uid: string): Promise<Task | undefined>;
  create(list: string, input: NewTask): Promise<Task>;
  update(list: string, uid: string, patch: TodoPatch): Promise<Task>;
};

export type SourceOptions = {
  /** For tests. Default Date.now. */
  now?: () => number;
  /** For tests. Default crypto.randomUUID. */
  uuid?: () => string;
};

function taskFrom(list: string, uid: string, resource: CalendarResource): Task {
  const todo = parseVTodos(resource.text).find((item) => item.uid === uid);
  if (!todo) throw new CalDavError("the task is not in the calendar object the server returned");
  return { ...todo, list, href: resource.href, etag: resource.etag };
}

/** The demo store: the same ICS code as CalDAV, over objects held in memory. Nothing leaves the process. */
export function demoSource(options: SourceOptions = {}): TaskSource {
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? randomUUID;
  const objects = new Map<string, { list: string; uid: string; ics: string; version: number }>();
  let version = 0;
  const key = (list: string, uid: string) => `${list}/${uid}`;
  for (const { list, ics } of demoObjects()) {
    for (const todo of parseVTodos(ics)) objects.set(key(list, todo.uid), { list, uid: todo.uid, ics, version: ++version });
  }
  const listNames = ["Aufgaben", "Arbeit"];
  const resourceOf = (entry: { list: string; uid: string; ics: string; version: number }): CalendarResource => ({
    href: `demo://${entry.list.toLowerCase()}/${entry.uid}.ics`,
    etag: `"demo-${entry.version}"`,
    text: entry.ics,
  });
  const requireList = (list: string) => {
    if (!listNames.includes(list)) throw new UnknownListError(list);
  };

  return {
    kind: "demo",
    listNames,
    async load() {
      return [...objects.values()].map((entry) => taskFrom(entry.list, entry.uid, resourceOf(entry)));
    },
    async get(list, uid) {
      requireList(list);
      const entry = objects.get(key(list, uid));
      return entry ? taskFrom(list, uid, resourceOf(entry)) : undefined;
    },
    async create(list, input) {
      requireList(list);
      const uid = uuid();
      const entry = { list, uid, ics: buildNewTodo({ ...input, uid }, now()), version: ++version };
      objects.set(key(list, uid), entry);
      return taskFrom(list, uid, resourceOf(entry));
    },
    async update(list, uid, patch) {
      requireList(list);
      const entry = objects.get(key(list, uid));
      if (!entry) throw new TaskNotFoundError();
      const edited = editTodo(entry.ics, uid, patch, now());
      if (edited.changed) {
        entry.ics = edited.ics;
        entry.version = ++version;
      }
      return taskFrom(list, uid, resourceOf(entry));
    },
  };
}

export function caldavSource(config: CalDavConfig, client?: CalDavClient, options: SourceOptions = {}): TaskSource {
  const caldav = client ?? new CalDavClient({ base: config.base, user: config.user, password: config.password });
  const now = options.now ?? Date.now;
  const uuid = options.uuid ?? randomUUID;
  const listFor = (name: string) => {
    const list = config.lists.find((item) => item.name === name);
    if (!list) throw new UnknownListError(name);
    return list;
  };

  /** The href of the resource that holds this UID. Other clients name their files freely, so it is looked up. */
  async function hrefOf(listName: string, uid: string): Promise<string | undefined> {
    const list = listFor(listName);
    for (const object of await caldav.queryTodos(list.path)) {
      if (parseVTodos(object.data).some((todo) => todo.uid === uid)) return object.href;
    }
    return undefined;
  }

  async function readBack(listName: string, uid: string, href: string): Promise<Task> {
    return taskFrom(listName, uid, await caldav.getResource(href));
  }

  return {
    kind: "caldav",
    listNames: config.lists.map((list) => list.name),
    async load() {
      const perList = await Promise.all(config.lists.map((list) => caldav.listTasks(list)));
      return perList.flat();
    },
    async get(listName, uid) {
      const href = await hrefOf(listName, uid);
      return href ? await readBack(listName, uid, href) : undefined;
    },
    async create(listName, input) {
      const list = listFor(listName);
      const uid = uuid();
      let written: { href: string };
      try {
        written = await caldav.putNew(list.path, uid, buildNewTodo({ ...input, uid }, now()));
      } catch (error) {
        if (error instanceof CalDavError && error.status === 412) throw new TaskConflictError();
        throw error;
      }
      return await readBack(listName, uid, written.href);
    },
    async update(listName, uid, patch) {
      const href = await hrefOf(listName, uid);
      if (!href) throw new TaskNotFoundError();
      let resource: CalendarResource;
      try {
        resource = await caldav.getResource(href);
      } catch (error) {
        if (error instanceof CalDavError && error.status === 404) throw new TaskNotFoundError();
        throw error;
      }
      let edited: { ics: string; changed: boolean };
      try {
        edited = editTodo(resource.text, uid, patch, now());
      } catch (error) {
        if (error instanceof TodoNotFoundError) throw new TaskNotFoundError();
        throw error;
      }
      if (!edited.changed) return taskFrom(listName, uid, resource);
      try {
        await caldav.putExisting(href, edited.ics, resource.etag ?? "");
      } catch (error) {
        if (error instanceof CalDavError && error.status === 412) throw new TaskConflictError();
        throw error;
      }
      return await readBack(listName, uid, href);
    },
  };
}

/** What the UI and the API send. Unknown properties stay on the server: the client only needs the mapped fields. */
export type TaskView = {
  uid: string;
  list: string;
  summary: string;
  description: string | null;
  status: Task["status"];
  priority: Task["priority"];
  due: { date: string; time: string | null; allDay: boolean } | null;
  /** The VTODO CATEGORIES, named tags outside the iCalendar layer. */
  tags: string[];
  someday: boolean;
};

export function toView(task: Task): TaskView {
  return {
    uid: task.uid,
    list: task.list,
    summary: task.summary,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due: task.due ? { date: task.due.date, time: task.due.time, allDay: task.due.allDay } : null,
    tags: task.categories,
    someday: task.someday,
  };
}

/** Open first by due date (dated before undated), then priority (high first, unset last), then list and summary. */
export function sortBacklog(tasks: Task[]): Task[] {
  const rank = (task: Task) => task.priority ?? 10;
  return [...tasks].sort((a, b) => {
    const da = a.due ? `${a.due.date}T${a.due.time ?? "00:00:00"}` : "9999";
    const db = b.due ? `${b.due.date}T${b.due.time ?? "00:00:00"}` : "9999";
    if (da !== db) return da < db ? -1 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.list.localeCompare(b.list) || a.summary.localeCompare(b.summary, "de");
  });
}

export async function loadBacklog(source: TaskSource, includeClosed: boolean): Promise<TaskView[]> {
  const tasks = await source.load();
  return sortBacklog(includeClosed ? tasks : tasks.filter(isOpen)).map(toView);
}
