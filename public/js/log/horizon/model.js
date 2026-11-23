/*
 * Pure model of the Future and Month views: which months they cover, the range they read, where a new line goes, and how entries group
 * under a month. No DOM, no fetch, no strings to show. Needs dates.js, days.js and pages/model.js (shiftMonth).
 *
 * The three views are 'future', 'month' and 'daily'. Future and Month share one read: the first day of this month through the end
 * of the sixth month (this month and five more). A month-task or future item is dated by the last day of its month, so it sorts
 * after every day of that month.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.horizon = L.horizon || {};

  var VIEWS = ['future', 'month', 'daily'];
  var MONTHS_SHOWN = 6;
  var FUTURE_PER_PAGE = 3;
  var MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

  /** True for a view name the log knows. */
  function isView(name) {
    return VIEWS.indexOf(name) >= 0;
  }

  /** The months of the Future Log: this month and the five after it, as YYYY-MM. */
  function futureMonths(today) {
    var first = L.pages.model.monthOf(today);
    var months = [];
    for (var step = 0; step < MONTHS_SHOWN; step += 1) months.push(L.pages.model.shiftMonth(first, step));
    return months;
  }

  /** The days Future and Month read: the first of this month through the end of the sixth month. */
  function span(today) {
    return { from: L.dates.monthStart(today), to: L.dates.monthEnd(today, MONTHS_SHOWN - 1) };
  }

  /** The last day of a month (YYYY-MM): the date a month-task or future item of that month carries. */
  function lastDay(month) {
    return L.dates.monthEnd(month + '-01', 0);
  }

  /** A ?month= value as a month the views can show, else null. */
  function readMonth(text, today) {
    if (typeof text !== 'string' || !MONTH.test(text)) return null;
    return futureMonths(today).indexOf(text) >= 0 ? text : null;
  }

  /** Where a new line goes while a view is open: { date, horizon }. Month files under the month on screen (a month-task this month, a
   * future item later). Future files under the month after this one on its first page, else under the first month of the open page;
   * a written @month or the Date key can change either. */
  function slotOf(view, month, today, page) {
    var here = L.pages.model.monthOf(today);
    var target = month;
    if (view === 'future') target = page ? futureMonths(today)[page * FUTURE_PER_PAGE] : L.pages.model.shiftMonth(here, 1);
    return { date: lastDay(target), horizon: target <= here ? 'month-task' : 'future' };
  }

  /** Every day of a month in date order: [{ date, entries, traces }]. The paper calendar writes out all of them, so a day with nothing on it is listed too.
   * Only the calendar's own entries and traces are listed (month-calendar): the daily log is a separate page and never shows here. */
  function monthDays(entries, month) {
    return L.dates.daysOfMonth(month).map(function (date) {
      return { date: date, entries: L.days.groupEntries(entries, 'month-calendar', date), traces: L.days.tracesOf(entries, 'month-calendar', date) };
    });
  }

  /** The pages of the Month view, in the order they turn: for each of the six months its calendar, then its tasks. [{ month, part }] */
  function monthPages(today) {
    return futureMonths(today).reduce(function (pages, month) {
      return pages.concat([{ month: month, part: 'calendar' }, { month: month, part: 'tasks' }]);
    }, []);
  }

  /** The Month page n steps from a page ({ month, part }), or null past either end. Walks the calendar and tasks pages of every month in turn. */
  function monthStep(page, n, today) {
    var pages = monthPages(today);
    var at = pages.findIndex(function (item) { return item.month === page.month && item.part === page.part; });
    return at < 0 ? null : pages[at + n] || null;
  }

  /** The cards of the entries filed under a whole month: the month-tasks first, then the future items, each group in its own order. */
  function monthCards(entries, month) {
    var date = lastDay(month);
    var groups = ['month-task', 'future'].map(function (horizon) { return L.days.groupEntries(entries, horizon, date); });
    return groups.reduce(function (cards, group) { return cards.concat(L.days.cardsOf(group)); }, []);
  }

  /** The traces left on the lanes of a whole month (month tasks and future items), after the entries. */
  function monthTraces(entries, month) {
    var date = lastDay(month);
    return ['month-task', 'future'].reduce(function (all, horizon) { return all.concat(L.days.tracesOf(entries, horizon, date)); }, []);
  }

  /** The six buckets of the Future Log: [{ month, cards, traces }], this month first. */
  function buckets(entries, today) {
    return futureMonths(today).map(function (month) {
      return { month: month, cards: monthCards(entries, month), traces: monthTraces(entries, month) };
    });
  }

  /** The Future Log in pages of three months: [[bucket, bucket, bucket], [bucket, bucket, bucket]], this month first. */
  function futurePages(entries, today) {
    var all = buckets(entries, today);
    var pages = [];
    for (var at = 0; at < all.length; at += FUTURE_PER_PAGE) pages.push(all.slice(at, at + FUTURE_PER_PAGE));
    return pages;
  }

  /** The Future page n steps from a page number (from 0), as { page }, or null past either end. */
  function futureStep(page, n) {
    var next = page + n;
    return next >= 0 && next < MONTHS_SHOWN / FUTURE_PER_PAGE ? { page: next } : null;
  }

  L.horizon.model = {
    VIEWS: VIEWS, isView: isView, futureMonths: futureMonths, span: span, lastDay: lastDay, readMonth: readMonth,
    slotOf: slotOf, monthDays: monthDays, monthPages: monthPages, monthStep: monthStep, monthCards: monthCards, monthTraces: monthTraces,
    buckets: buckets, futurePages: futurePages, futureStep: futureStep
  };
})();
