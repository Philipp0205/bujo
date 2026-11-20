// Built-in demo tasks, so the UI works locally with nothing configured. Invented text, not from any real list.
// They go through the real ICS parser, so the demo also exercises the mapping.

import { parseVTodos, type Task } from "./ics.ts";

function todo(lines: string[]): string {
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//bujo//demo//EN", "BEGIN:VTODO", ...lines, "END:VTODO", "END:VCALENDAR"].join("\r\n") + "\r\n";
}

const AUFGABEN = [
  todo(["UID:demo-1", "SUMMARY:Steuerunterlagen sortieren", "PRIORITY:1", "DUE;VALUE=DATE:20261130", "CATEGORIES:Haushalt,Papierkram", "STATUS:NEEDS-ACTION"]),
  todo(["UID:demo-2", "SUMMARY:Fahrrad zur Inspektion bringen", "PRIORITY:5", "CATEGORIES:Haushalt", "STATUS:NEEDS-ACTION"]),
  todo(["UID:demo-3", "SUMMARY:Geschenke kaufen\\, einpacken", "PRIORITY:9", "DUE;TZID=Europe/Berlin:20261215T170000", "STATUS:NEEDS-ACTION"]),
  todo(["UID:demo-4", "SUMMARY:Balkon neu bepflanzen", "CATEGORIES:someday,Garten", "STATUS:NEEDS-ACTION"]),
  todo(["UID:demo-5", "SUMMARY:Bibliothek Buecher zurueckgeben", "STATUS:COMPLETED", "PERCENT-COMPLETE:100", "COMPLETED:20261101T090000Z"]),
];

const ARBEIT = [
  todo(["UID:demo-6", "SUMMARY:Quartalsbericht entwerfen", "PRIORITY:1", "DUE;VALUE=DATE:20261127", "CATEGORIES:Bericht", "STATUS:IN-PROCESS"]),
  todo(["UID:demo-7", "SUMMARY:Backup-Konzept pruefen", "PRIORITY:5", "CATEGORIES:Technik", "STATUS:NEEDS-ACTION"]),
  todo(["UID:demo-8", "SUMMARY:Konferenz im Fruehjahr recherchieren", "CATEGORIES:someday,Technik", "STATUS:NEEDS-ACTION"]),
  todo(["UID:demo-9", "SUMMARY:Altes Ticket schliessen", "STATUS:CANCELLED"]),
];

/** The demo calendar objects as ICS text, per list. A new copy each call, so one demo store never shares state with another. */
export function demoObjects(): Array<{ list: string; ics: string }> {
  return [
    ...AUFGABEN.map((ics) => ({ list: "Aufgaben", ics })),
    ...ARBEIT.map((ics) => ({ list: "Arbeit", ics })),
  ];
}

export function demoTasks(): Task[] {
  const tasks: Task[] = [];
  for (const { list, ics } of demoObjects()) {
    for (const parsed of parseVTodos(ics)) {
      tasks.push({ ...parsed, list, href: `demo://${list.toLowerCase()}/${parsed.uid}.ics`, etag: null });
    }
  }
  return tasks;
}
