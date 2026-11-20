import { CalDavClient } from "./client.ts";
import type { CalDavConfig } from "./config.ts";
import { demoTasks } from "./demo.ts";
import { isOpen, type Task } from "./ics.ts";

/** Where the backlog comes from. Read-only: there is nothing here that writes. */
export type TaskSource = {
  kind: "caldav" | "demo";
  listNames: string[];
  load(): Promise<Task[]>;
};

export function demoSource(): TaskSource {
  return { kind: "demo", listNames: ["Aufgaben", "Arbeit"], load: async () => demoTasks() };
}

export function caldavSource(config: CalDavConfig, client?: CalDavClient): TaskSource {
  const caldav = client ?? new CalDavClient({ base: config.base, user: config.user, password: config.password });
  return {
    kind: "caldav",
    listNames: config.lists.map((list) => list.name),
    async load() {
      const perList = await Promise.all(config.lists.map((list) => caldav.listTasks(list)));
      return perList.flat();
    },
  };
}

/** What /api/backlog sends. Unknown properties stay on the server: the client only needs the mapped fields. */
export type TaskView = {
  uid: string;
  list: string;
  summary: string;
  description: string | null;
  status: Task["status"];
  priority: Task["priority"];
  due: { date: string; time: string | null; allDay: boolean } | null;
  categories: string[];
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
    categories: task.categories,
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
