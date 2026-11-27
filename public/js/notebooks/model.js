/*
 * Pure model of the notebooks screens: which page numbers of a notebook are scanned (the client twin of src/log/notebook-pages.ts),
 * the sections of a notebook, the words of its dates and the checks of the start-a-notebook form. No DOM, no fetch.
 * Needs notebooks/copy.js and index/copy.js (the month names).
 */
(function () {
  'use strict';

  var N = window.BujoNotebooks = window.BujoNotebooks || {};

  /** The numbers 1..pageCount, each { number, scanned, item? }. The first page of a number wins; numbers above pageCount are left out. */
  function pageStatus(pages, pageCount) {
    var byNumber = {};
    pages.forEach(function (page) { if (!byNumber[page.number]) byNumber[page.number] = page; });
    var out = [];
    for (var number = 1; number <= pageCount; number++) {
      var item = byNumber[number];
      out.push(item ? { number: number, scanned: true, item: item } : { number: number, scanned: false });
    }
    return out;
  }

  /** How many of the numbers are scanned. */
  function scannedCount(status) {
    return status.filter(function (cell) { return cell.scanned; }).length;
  }

  /** The listed pages split by what they are: daily logs, monthly logs and future logs (collections are shown as collections). */
  function sections(pages) {
    var pick = function (kind) { return pages.filter(function (page) { return page.kind === kind; }); };
    return { daily: pick('day'), month: pick('month'), future: pick('future') };
  }

  /** "20 Nov 2026" for a YYYY-MM-DD day. */
  function dateLabel(iso) {
    return Number(iso.slice(8, 10)) + ' ' + window.BujoIndex.copy.shortMonth(iso.slice(0, 7));
  }

  /** The dates line of a notebook: "Since 20 Nov 2026" while it is active, "20 Nov 2026 to 3 Mar 2027" once it ended. */
  function datesOf(notebook) {
    var copy = N.copy;
    if (!notebook.endedOn) return copy.since(dateLabel(notebook.startedOn));
    return copy.range(dateLabel(notebook.startedOn), dateLabel(notebook.endedOn));
  }

  /** The name offered when starting a notebook: "Notebook 3" after two. */
  function suggestedName(notebooks) {
    return N.copy.defaultName(notebooks.length + 1);
  }

  /** The page count typed in the form: a whole number 1..9999 as { ok, value }. Anything else is { ok: false }. */
  function parsePages(text) {
    var clean = String(text).trim();
    if (!/^\d{1,4}$/.test(clean)) return { ok: false };
    var value = Number(clean);
    return value >= 1 && value <= 9999 ? { ok: true, value: value } : { ok: false };
  }

  N.model = { pageStatus: pageStatus, scannedCount: scannedCount, sections: sections, dateLabel: dateLabel, datesOf: datesOf, suggestedName: suggestedName, parsePages: parsePages };
})();
