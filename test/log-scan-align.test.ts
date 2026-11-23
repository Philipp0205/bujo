import assert from "node:assert/strict";
import test from "node:test";
import { matchKey } from "../src/scan/match.ts";
import { alignLines } from "../src/log/scan/align.ts";
import { checkLines } from "../src/log/scan/draft.ts";
import { resolveLines } from "../src/log/scan/resolve.ts";
import type { Line } from "../src/log/scan/types.ts";
import type { EntryType, ScanEntry } from "../src/log/types.ts";

const DAY = "2026-11-20";

type Over = Partial<ScanEntry> & { snap?: { type?: EntryType; title?: string; tags?: string[]; time?: string | null; at: number } };

/** A day entry with an optional last-scan snapshot. */
function entry(id: string, type: EntryType, title: string, over: Over = {}): ScanEntry {
  const { snap, ...rest } = over;
  const scan = snap
    ? { key: matchKey(snap.title ?? title), type: snap.type ?? type, title: snap.title ?? title, tags: snap.tags ?? [], time: snap.time ?? null, at: snap.at }
    : null;
  return { id, date: DAY, horizon: "day", type, title, tags: [], time: null, body: null, hasPhoto: false, indent: 0, sync: "local", syncError: null, position: 0, createdAt: 0, updatedAt: 0, onPaper: false, scan, ...rest };
}

const paper = (id: string, type: EntryType, title: string, tags: string[] = [], time: string | null = null): Line => ({ id, type, title, tags, time });
const statusOf = (lines: Line[], existing: ScanEntry[]) => [...resolveLines(lines, existing)].map(([id, r]) => [id, r.status]);

test("unchanged: the same type, title, tag and time binds and is not new", () => {
  const existing = [entry("e1", "task", "Brot kaufen", { tags: ["Haushalt"], time: "10:00" })];
  const out = resolveLines([paper("a", "task", "Brot kaufen", ["Haushalt"], "10:00")], existing);
  assert.equal(out.get("a")?.status, "unchanged");
  assert.equal(out.get("a")?.target?.id, "e1");
  assert.equal(out.get("a")?.before, null);
});

test("unchanged: a paper line that says no tag or time does not clear the entry's", () => {
  const out = resolveLines([paper("a", "task", "Brot kaufen")], [entry("e1", "task", "Brot kaufen", { tags: ["Haushalt", "Einkauf"], time: "10:00" })]);
  assert.equal(out.get("a")?.status, "unchanged");
});

test("unchanged: the same tags in another order or another case are the same set", () => {
  const existing = [entry("e1", "task", "Brot kaufen", { tags: ["Haushalt", "Einkauf"] })];
  const out = resolveLines([paper("a", "task", "Brot kaufen", ["einkauf", "HAUSHALT"])], existing);
  assert.equal(out.get("a")?.status, "unchanged");
});

test("edited: a tag added to or removed from a non-empty set is a change, and the entry's spelling is kept for the rest", () => {
  const existing = [entry("e1", "task", "Brot kaufen", { tags: ["Haushalt", "Einkauf"] }), entry("e2", "task", "Putzen", { tags: ["Haushalt"], position: 1 })];
  const out = resolveLines([paper("a", "task", "Brot kaufen", ["haushalt"]), paper("b", "task", "Putzen", ["haushalt", "Bad"])], existing);
  assert.equal(out.get("a")?.status, "edited", "a tag removed");
  assert.deepEqual(out.get("a")?.after?.tags, ["Haushalt"]);
  assert.deepEqual(out.get("a")?.before?.tags, ["Haushalt", "Einkauf"]);
  assert.equal(out.get("b")?.status, "edited", "a tag added");
  assert.deepEqual(out.get("b")?.after?.tags, ["Haushalt", "Bad"]);
});

test("edited: a symbol change, for every task-family symbol, with before and after", () => {
  for (const type of ["done", "migrated", "scheduled"] as const) {
    const out = resolveLines([paper("a", type, "Brot kaufen")], [entry("e1", "task", "Brot kaufen")]);
    const hit = out.get("a")!;
    assert.equal(hit.status, "edited", type);
    assert.equal(hit.before?.type, "task");
    assert.equal(hit.after?.type, type);
    assert.equal(hit.contested, false);
  }
});

test("edited: a title change, a tag added and a time added", () => {
  const existing = [entry("e1", "task", "Brot kaufen"), entry("e2", "event", "Zahnarzt", { position: 1 }), entry("e3", "task", "Putzen", { position: 2 })];
  const out = resolveLines(
    [paper("a", "task", "Brot kaufen und Milch"), paper("b", "event", "Zahnarzt", ["health"]), paper("c", "task", "Putzen", [], "09:30")],
    existing,
  );
  assert.deepEqual([...out.values()].map((r) => r.status), ["edited", "edited", "edited"]);
  assert.equal(out.get("a")?.after?.title, "Brot kaufen und Milch");
  assert.equal(out.get("a")?.target?.id, "e1");
  assert.deepEqual([out.get("b")?.before?.tags, out.get("b")?.after?.tags], [[], ["health"]]);
  assert.deepEqual([out.get("c")?.before?.time, out.get("c")?.after?.time], [null, "09:30"]);
});

test("edited: a title that matches but spells differently keeps the entry's spelling when nothing else changed", () => {
  const out = resolveLines([paper("a", "done", "MÜLLER anrufen")], [entry("e1", "task", "Mueller anrufen")]);
  assert.equal(out.get("a")?.status, "edited");
  assert.equal(out.get("a")?.after?.title, "Mueller anrufen");
});

test("new: a line with no match is new, and an empty title matches nothing", () => {
  const existing = [entry("e1", "task", "Brot kaufen")];
  assert.deepEqual(statusOf([paper("a", "task", "Steuererklärung"), paper("b", "task", "")], existing), [["a", "new"], ["b", "new"]]);
  assert.equal(resolveLines([paper("a", "task", "Steuererklärung")], existing).get("a")?.target, null);
  assert.deepEqual(statusOf([paper("a", "task", "")], [entry("e1", "task", "")]), [["a", "new"]]);
});

test("fuzzy text: case, umlaut spelling and small OCR slips still bind", () => {
  const existing = [entry("e1", "task", "Müller Grüße ausrichten"), entry("e2", "note", "Idee Wochenende", { position: 1 }), entry("e3", "task", "Zahnarzt anrufen", { position: 2 })];
  const out = resolveLines(
    [paper("a", "task", "mueller gruesse ausrichten"), paper("b", "note", "IDEE WOCHENENDE"), paper("c", "task", "Zahnarst anrufen")],
    existing,
  );
  assert.deepEqual([out.get("a")?.target?.id, out.get("b")?.target?.id, out.get("c")?.target?.id], ["e1", "e2", "e3"]);
  assert.deepEqual([out.get("a")?.status, out.get("b")?.status], ["unchanged", "unchanged"]);
  assert.equal(out.get("c")?.status, "unchanged", "OCR noise in the title only restates the entry, it is not an edit");
  assert.equal(out.get("c")?.after, null);
});

test("the stored scan key binds a line whose title the person later reworded in the app", () => {
  const existing = [entry("e1", "task", "Brot und Milch besorgen", { snap: { title: "Brot kaufen", at: 5 }, updatedAt: 9 })];
  const out = resolveLines([paper("a", "task", "Brot kaufen")], existing);
  assert.equal(out.get("a")?.target?.id, "e1");
});

test("app-edited: an unchanged paper line does not overwrite an entry the person changed after the last scan", () => {
  const existing = [entry("e1", "done", "Brot kaufen", { snap: { type: "task", at: 100 }, updatedAt: 200 })];
  const out = resolveLines([paper("a", "task", "Brot kaufen")], existing);
  assert.equal(out.get("a")?.status, "unchanged");
  assert.equal(out.get("a")?.protectedEdit, true);
  assert.equal(out.get("a")?.target?.id, "e1");
});

test("app-edited: a paper line that differs from the snapshot is a real paper change", () => {
  const existing = [entry("e1", "task", "Brot kaufen", { tags: ["Haushalt"], snap: { at: 100 }, updatedAt: 200 })];
  const out = resolveLines([paper("a", "migrated", "Brot kaufen")], existing);
  assert.equal(out.get("a")?.status, "edited");
});

test("both changed: edited with the app values as before and the paper as after, and it starts unticked", () => {
  const existing = [entry("e1", "task", "Brot kaufen", { tags: ["Haushalt", "Einkauf"], snap: { type: "task", at: 100 }, updatedAt: 200 })];
  const [check] = checkLines([paper("a", "done", "Brot kaufen")], existing);
  assert.equal(check.status, "edited");
  assert.equal(check.contested, true);
  assert.deepEqual(check.before, { type: "task", title: "Brot kaufen", tags: ["Haushalt", "Einkauf"], time: null });
  assert.deepEqual(check.after, { type: "done", title: "Brot kaufen", tags: ["Haushalt", "Einkauf"], time: null });
});

test("an entry the app edited before the last scan is not protected", () => {
  const existing = [entry("e1", "task", "Brot kaufen", { snap: { at: 300 }, updatedAt: 200 })];
  assert.equal(resolveLines([paper("a", "done", "Brot kaufen")], existing).get("a")?.status, "edited");
});

test("no deletes: an entry no line matches is absent from the result, never flagged", () => {
  const existing = [entry("e1", "task", "Brot kaufen"), entry("e2", "task", "Zahnarzt anrufen", { position: 1 })];
  const lines = [paper("a", "task", "Brot kaufen")];
  const out = resolveLines(lines, existing);
  assert.deepEqual([...out.keys()], ["a"]);
  assert.equal(JSON.stringify([...out.values()]).includes("e2"), false);
  assert.deepEqual(checkLines(lines, existing).map((c) => c.status), ["unchanged"]);
});

test("1:1: two identical lines do not claim one entry, and the first in page order wins", () => {
  const existing = [entry("e1", "task", "Brot kaufen")];
  const out = resolveLines([paper("a", "task", "Brot kaufen"), paper("b", "task", "brot kaufen")], existing);
  assert.deepEqual([out.get("a")?.status, out.get("a")?.target?.id], ["unchanged", "e1"]);
  assert.deepEqual([out.get("b")?.status, out.get("b")?.target], ["new", null]);
});

test("1:1: two similar lines bind to their own entries", () => {
  const existing = [entry("e1", "task", "Milch kaufen"), entry("e2", "task", "Milch kaufen gehen", { position: 1 })];
  const bound = alignLines([paper("a", "task", "Milch kaufen gehen"), paper("b", "task", "Milch kaufen")], existing);
  assert.equal(bound.get("a")?.id, "e2");
  assert.equal(bound.get("b")?.id, "e1");
});

test("ambiguous: a line that scores about the same against two free entries binds neither and is new", () => {
  const existing = [entry("e1", "task", "Anruf bei Mira morgen", { position: 0 }), entry("e2", "task", "Anruf bei Mira heute", { position: 1 })];
  const out = resolveLines([paper("a", "task", "Anruf bei Mira")], existing);
  assert.equal(out.get("a")?.status, "new");
  assert.equal(out.get("a")?.target, null);
});

test("an unrelated type binds only on a near-exact title", () => {
  const existing = [entry("e1", "event", "Lunch with Mira")];
  assert.equal(resolveLines([paper("a", "task", "Lunch with Mira")], existing).get("a")?.status, "edited");
  assert.equal(resolveLines([paper("a", "task", "Lunch with Mirko")], existing).get("a")?.status, "new");
});

test("match: case, bullets and punctuation in the title do not matter, and the line is unchanged", () => {
  const existing = [entry("e1", "task", "Zahnarzt anrufen")];
  for (const title of ["ZAHNARZT ANRUFEN!", "  zahnarzt   anrufen. ", "• Zahnarzt anrufen"]) {
    const hit = resolveLines([paper("a", "task", title)], existing).get("a")!;
    assert.deepEqual([hit.status, hit.target?.id], ["unchanged", "e1"], title);
  }
});

test("match: typo-level OCR noise is the same item, not a duplicate, and leaves the entry's title alone", () => {
  const existing = [entry("e1", "task", "Zahnarzt anrufen"), entry("e2", "task", "Gartentor streichen", { position: 1 })];
  const out = resolveLines([paper("a", "task", "Zahnarst anrufcn"), paper("b", "task", "Gartentor streichn")], existing);
  assert.deepEqual([out.get("a")?.status, out.get("a")?.target?.id], ["unchanged", "e1"]);
  assert.deepEqual([out.get("b")?.status, out.get("b")?.target?.id], ["unchanged", "e2"]);
});

test("match: below 70 percent is not a match, the line is new", () => {
  const existing = [entry("e1", "task", "Brot kaufen")];
  for (const title of ["Brot holen", "Milch trinken", "Brct kautcn"]) {
    const hit = resolveLines([paper("a", "task", title)], existing).get("a")!;
    assert.deepEqual([hit.status, hit.target], ["new", null], title);
  }
});

test("state change: x on paper over a task in the app marks that item done, with the same title and no second row", () => {
  const existing = [entry("e1", "task", "Zahnarzt anrufen")];
  const hit = resolveLines([paper("a", "done", "Zahnarst anrufen")], existing).get("a")!;
  assert.equal(hit.status, "edited");
  assert.equal(hit.target?.id, "e1");
  assert.deepEqual([hit.before?.type, hit.after?.type, hit.after?.title], ["task", "done", "Zahnarzt anrufen"]);
});

test("state change: > and < over a task are the migration and the schedule of that item", () => {
  const existing = [entry("e1", "task", "Zahnarzt anrufen"), entry("e2", "task", "Brot kaufen", { position: 1 })];
  const out = resolveLines([paper("a", "migrated", "Zahnarzt anrufcn"), paper("b", "scheduled", "Brot kaufen")], existing);
  assert.deepEqual([out.get("a")?.status, out.get("a")?.target?.id, out.get("a")?.after?.type], ["edited", "e1", "migrated"]);
  assert.deepEqual([out.get("b")?.status, out.get("b")?.target?.id, out.get("b")?.after?.type], ["edited", "e2", "scheduled"]);
});

test("1:1: two similar lines use each entry at most once, and each line prefers its best entry whatever the page order", () => {
  const existing = [entry("e1", "task", "Milch kaufen"), entry("e2", "task", "Milch kaufen gehen", { position: 1 })];
  for (const lines of [[paper("a", "task", "Milch kaufen gehe"), paper("b", "task", "Milch kaufcn")], [paper("b", "task", "Milch kaufcn"), paper("a", "task", "Milch kaufen gehe")]]) {
    const bound = alignLines(lines, existing);
    assert.equal(bound.get("a")?.id, "e2");
    assert.equal(bound.get("b")?.id, "e1");
  }
  const one = alignLines([paper("a", "task", "Milch kaufen gehe"), paper("b", "task", "Milch kaufen gehn")], [entry("e2", "task", "Milch kaufen gehen")]);
  assert.deepEqual([one.get("a")?.id, one.has("b")], ["e2", false], "the second line gets no entry once the first claimed it");
});

test("un-matched: a line the person un-matched is new, claims no entry, and leaves the entry to another line", () => {
  const existing = [entry("e1", "task", "Zahnarzt anrufen")];
  const out = resolveLines([{ ...paper("a", "task", "Zahnarst anrufen"), unmatched: true }, paper("b", "task", "Zahnarzt anrufen")], existing);
  assert.deepEqual([out.get("a")?.status, out.get("a")?.target], ["new", null]);
  assert.deepEqual([out.get("b")?.status, out.get("b")?.target?.id], ["unchanged", "e1"]);
});
