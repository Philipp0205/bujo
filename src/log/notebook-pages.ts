/** One number of a notebook: whether a scan or a collection holds it, and which page that is (the first when several share the number). */
export type PageStatus<T extends { number: number }> = { number: number; scanned: boolean; item?: T };

/**
 * The numbers 1..pageCount of a notebook, each marked scanned or not. `pages` is what the notebook has (any order; the first of a
 * number wins). Numbers above pageCount are left out. Pure: no db, no clock, so a reminder can scope it to one notebook later.
 */
export function pageStatus<T extends { number: number }>(pages: readonly T[], pageCount: number): Array<PageStatus<T>> {
  const byNumber = new Map<number, T>();
  for (const page of pages) if (!byNumber.has(page.number)) byNumber.set(page.number, page);
  return Array.from({ length: Math.max(0, pageCount) }, (_, index) => {
    const number = index + 1;
    const item = byNumber.get(number);
    return item === undefined ? { number, scanned: false } : { number, scanned: true, item };
  });
}
