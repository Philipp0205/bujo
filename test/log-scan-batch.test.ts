import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

type Page = { status: string; type: string; state: { paperText: string } | null };
type Batch = {
  MAX_PAGES: number;
  exceeds(count: number): boolean;
  settled(page: Page): boolean;
  allSettled(pages: Page[]): boolean;
  nextOpen(pages: Page[], from: number): number;
  numbers(pages: Page[], except: Page | null): number[];
  landing(last: Record<string, unknown>, pages: Page[]): Record<string, unknown>;
};
type Gap = { model: { missing(known: number[], added: number, skipped?: number[]): number[] } };

/** The real batch rules, the scan model (for the page number field) and the gap model in a page-like sandbox. */
function load(): { batch: Batch; gap: Gap } {
  const window: { BujoLog: { scan?: { batch: Batch }; gap?: Gap } } = { BujoLog: {} };
  const context = vm.createContext({ window, String, Math, Number, Array, Object, RegExp, Date, Blob: class {} });
  for (const file of ["gap/model.js", "scan/model.js", "scan/batch.js"]) {
    vm.runInContext(readFileSync(new URL(`../public/js/log/${file}`, import.meta.url), "utf8"), context);
  }
  return { batch: window.BujoLog.scan!.batch, gap: window.BujoLog.gap! };
}

const { batch, gap } = load();
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const page = (status: string, number = "", type = "log"): Page => ({ status, type, state: status === "failed" ? null : { paperText: number } });

test("a batch holds at most 10 pages", () => {
  assert.equal(batch.MAX_PAGES, 10);
  assert.equal(batch.exceeds(1), false);
  assert.equal(batch.exceeds(10), false);
  assert.equal(batch.exceeds(11), true);
});

test("applied, saved and skipped pages are settled, pending and failed pages are not", () => {
  assert.deepEqual(["pending", "applied", "saved", "skipped", "failed"].map((status) => batch.settled(page(status))), [false, true, true, true, false]);
  assert.equal(batch.allSettled([page("applied"), page("skipped")]), true);
  assert.equal(batch.allSettled([page("applied"), page("failed")]), false);
});

test("the next page to open is the next pending one (wrapping), then a failed one, then none", () => {
  const pages = [page("pending"), page("applied"), page("pending"), page("failed")];
  assert.equal(batch.nextOpen(pages, 0), 2);
  assert.equal(batch.nextOpen(pages, 2), 0);
  assert.equal(batch.nextOpen([page("applied"), page("failed"), page("skipped")], 0), 1);
  assert.equal(batch.nextOpen([page("applied")], 0), -1);
  assert.equal(batch.nextOpen([page("applied"), page("saved")], 1), -1);
});

test("batch numbers count the other pages to review or applied, not skipped, failed, note or empty ones", () => {
  const mine = page("pending", "6");
  const pages = [page("pending", "4"), mine, page("applied", "5"), page("skipped", "9"), page("failed"), page("pending", "7", "note"), page("pending", ""), page("pending", "x")];
  assert.deepEqual(plain(batch.numbers(pages, mine)), [4, 5]);
  assert.deepEqual(plain(batch.numbers(pages, null)), [4, 6, 5]);
});

test("the batch lands on the last page, with the highest number of the applied pages", () => {
  const pages = [page("applied", "6"), page("applied", "4"), page("skipped", "9"), page("saved", "", "note")];
  const last = { view: "daily", date: "2026-11-18", paperNumber: 4 };
  assert.deepEqual(plain(batch.landing(last, pages)), { view: "daily", date: "2026-11-18", paperNumber: 6 });
  assert.deepEqual(plain(batch.landing({ view: "daily", date: "2026-11-18" }, [page("saved", "", "note")])), { view: "daily", date: "2026-11-18" });
});

test("pages 4 and 6 in one batch with 5 missing remind about 5 once, and with 5 in the batch not at all", () => {
  const missing = (known: number[], number: number) => plain(gap.model.missing(known, number, []));
  const four = page("applied", "4");
  const six = page("applied", "6");
  const applied = [four, six];
  // After the batch, the reminder looks at the highest applied number against what the server knows (4 and 6 both stored).
  const reminded = Number((batch.landing({}, applied) as { paperNumber: number }).paperNumber);
  assert.equal(reminded, 6);
  assert.deepEqual(missing([4, 6], reminded), [5]);
  // Applied in the other order (6 first, then 4) the last applied page is 4, yet the batch number is still 6.
  assert.equal((batch.landing({ paperNumber: 4 }, [six, four]) as { paperNumber: number }).paperNumber, 6);
  // Mid-batch the review of page 6 counts the page 4 of the batch as known, so 5 is named; with a page 5 in the batch it is not.
  assert.deepEqual(missing([...batch.numbers([four, six], six)], 6), [5]);
  assert.deepEqual(missing([...batch.numbers([four, six, page("pending", "5")], six)], 6), []);
});
