/*
 * Pure model of the daily pages: which days are pages, their numbers, the neighbours of a page, the ?day= value and the
 * month grid of the day picker. No DOM, no fetch, no strings to show. Needs dates.js and days.js. Only day entries make pages.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  var ISO = /^\d{4}-\d{2}-\d{2}$/;

  /** The pages in date order: every day with entries, plus today even when it is empty. */
  function sequence(entries, today) {
    var seen = {};
    entries.forEach(function (entry) { if (L.days.horizonOf(entry) === 'day') seen[entry.date] = true; });
    seen[today] = true;
    return Object.keys(seen).sort();
  }

  /** The 1-based page number of a day in the sequence, or 0 when it is not a page. */
  function numberOf(days, date) {
    return days.indexOf(date) + 1;
  }

  /** The page before and after a day ({ prev, next }, null at the ends). Works for a day that is not a page, too. */
  function neighbours(days, date) {
    var prev = null;
    var next = null;
    days.forEach(function (day) {
      if (day < date) prev = day;
      else if (day > date && next === null) next = day;
    });
    return { prev: prev, next: next };
  }

  /** The page to show for a wanted day: itself when it is a page, else the page before it, else the one after, else today. */
  function settle(days, wanted, today) {
    if (!wanted || days.indexOf(wanted) >= 0) return wanted || today;
    var around = neighbours(days, wanted);
    return around.prev || around.next || today;
  }

  /** A ?day= value as a day: only a real calendar day written YYYY-MM-DD that the log can load around today, else null. */
  function readDay(text, today) {
    if (typeof text !== 'string' || !ISO.test(text)) return null;
    if (L.dates.addDays(text, 0) !== text) return null;
    return L.dates.reaches(today, text) ? text : null;
  }

  /** The month (YYYY-MM) a day is in. */
  function monthOf(date) {
    return date.slice(0, 7);
  }

  /** The month n months after (or before) a month. */
  function shiftMonth(month, n) {
    var index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
    var year = Math.floor(index / 12);
    var number = index % 12 + 1;
    return year + '-' + (number < 10 ? '0' : '') + number;
  }

  /** The first and last day of a month. */
  function monthRange(month) {
    var first = month + '-01';
    return { from: first, to: L.dates.addDays(shiftMonth(month, 1) + '-01', -1) };
  }

  /** The weeks of a month, Monday first: seven cells each, a day or null for the blanks around the month. */
  function monthWeeks(month) {
    var range = monthRange(month);
    var lead = (L.dates.parseIso(range.from).getUTCDay() + 6) % 7;
    var cells = [];
    for (var i = 0; i < lead; i += 1) cells.push(null);
    for (var day = range.from; day <= range.to; day = L.dates.addDays(day, 1)) cells.push(day);
    while (cells.length % 7) cells.push(null);
    var weeks = [];
    for (var at = 0; at < cells.length; at += 7) weeks.push(cells.slice(at, at + 7));
    return weeks;
  }

  /** Whether a month has any day the log can load around today. */
  function monthReaches(month, today) {
    var range = monthRange(month);
    return L.dates.reaches(today, range.from) || L.dates.reaches(today, range.to);
  }

  /** A map of the days that have entries, from a list of entries. */
  function marksOf(entries) {
    var marks = {};
    entries.forEach(function (entry) { if (L.days.horizonOf(entry) === 'day') marks[entry.date] = true; });
    return marks;
  }

  /** Whether a day can be chosen in the picker: a page (it has entries) or today, and loadable. */
  function pickable(date, marks, today) {
    return (date === today || marks[date] === true) && L.dates.reaches(today, date);
  }

  /** Whether a day lies inside a { from, to } range. */
  function within(range, date) {
    return date >= range.from && date <= range.to;
  }

  L.pages.model = {
    sequence: sequence, numberOf: numberOf, neighbours: neighbours, settle: settle, readDay: readDay, within: within,
    monthOf: monthOf, shiftMonth: shiftMonth, monthRange: monthRange, monthWeeks: monthWeeks,
    monthReaches: monthReaches, marksOf: marksOf, pickable: pickable
  };
})();
