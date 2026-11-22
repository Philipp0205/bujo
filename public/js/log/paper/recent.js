/*
 * The 14-day window of "not on paper": which entries count as candidates. Older app entries predate scan provenance and
 * would all look unwritten. Pure, no DOM. Needs dates.js. Shared by the log, the list sheet, the header count and Notes.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** Days back that still count. Must match PAPER_WINDOW_DAYS in src/log/paper.ts. */
  var PAPER_WINDOW_DAYS = 14;

  /** The first day of the window: a day this old is in, one day older is out. */
  function first(today) {
    return L.dates.addDays(today, -PAPER_WINDOW_DAYS);
  }

  /** Whether a day is today, up to PAPER_WINDOW_DAYS back, or ahead (upcoming days are never old leftovers). */
  function contains(date, today) {
    return date >= first(today);
  }

  /** Whether an entry or note gets the "not on paper" mark: it is not on paper and its day is in the window. */
  function shows(entry, today) {
    return !entry.onPaper && contains(entry.date, today);
  }

  L.paper.recent = { PAPER_WINDOW_DAYS: PAPER_WINDOW_DAYS, first: first, contains: contains, shows: shows };
})();
