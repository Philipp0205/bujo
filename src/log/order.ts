import type { Entry } from "./types.ts";

/** True when pages never go back: paper pages ascending, entries not on paper (no page) after them all. */
function pagesInOrder(pages: ReadonlyArray<number | null>): boolean {
  const rank = (page: number | null): number => (page === null ? Infinity : page);
  return pages.every((page, index) => index === 0 || rank(pages[index - 1]) <= rank(page));
}

/**
 * The ids of a day after a drag: the entries named in `ids` take the places those entries held, in the new order; any other entry
 * of the day (a free note the log does not show) keeps its place. Null when `ids` repeats an id, names an entry that is not in
 * the day, or would put an entry across a paper page boundary (the pages are fixed by the paper).
 */
export function reorderedIds(day: readonly Entry[], ids: readonly string[]): string[] | null {
  const byId = new Map(day.map((entry) => [entry.id, entry]));
  if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) return null;
  const listed = new Set(ids);
  let next = 0;
  const order = day.map((entry) => (listed.has(entry.id) ? ids[next++] : entry.id));
  return pagesInOrder(order.map((id) => byId.get(id)!.page)) ? order : null;
}
