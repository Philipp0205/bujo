/*
 * Pure date helpers for the rapid log. A day is a YYYY-MM-DD string. No DOM, no fetch, no strings to show.
 * Arithmetic runs in UTC so a daylight saving change never skips or repeats a day.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  var BACK_DAYS = 6;
  var AHEAD_DAYS = 7;
  /** The longest range the server lists (RANGE_MAX_DAYS in src/log/validation.ts). */
  var MAX_DAYS = 92;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Today as the person's own calendar day, not the UTC day. */
  function todayIso(now) {
    var date = now || new Date();
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function parseIso(iso) {
    var parts = iso.split('-').map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  /** The day n days after (or before, when negative) a given day. */
  function addDays(iso, n) {
    var date = parseIso(iso);
    date.setUTCDate(date.getUTCDate() + n);
    return date.toISOString().slice(0, 10);
  }

  /** The heading of a day: English weekday, German day and month, like "Wednesday 18.11". */
  function dayHeading(iso) {
    var weekday = parseIso(iso).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    return weekday + ' ' + iso.slice(8, 10) + '.' + iso.slice(5, 7);
  }

  /** The days the log shows around today: six back, seven ahead. */
  function windowAround(today) {
    return { from: addDays(today, -BACK_DAYS), to: addDays(today, AHEAD_DAYS) };
  }

  /** The usual window, stretched to include one more day (a scan applied to a day outside it), within the server's range cap. */
  function windowWith(today, extra) {
    var usual = windowAround(today);
    if (!extra) return usual;
    var from = extra < usual.from ? extra : usual.from;
    var to = extra > usual.to ? extra : usual.to;
    var first = addDays(to, -(MAX_DAYS - 1));
    return { from: from < first ? first : from, to: to };
  }

  /** The first and last day the log can load together with the usual window around today (the stretched window stays within the server's range cap). */
  function reachable(today) {
    var usual = windowAround(today);
    return { from: addDays(usual.to, -(MAX_DAYS - 1)), to: addDays(usual.from, MAX_DAYS - 1) };
  }

  /** Whether a day can be loaded together with the usual window around today. */
  function reaches(today, iso) {
    var range = reachable(today);
    return iso >= range.from && iso <= range.to;
  }

  L.dates = {
    todayIso: todayIso, parseIso: parseIso, addDays: addDays, dayHeading: dayHeading, windowAround: windowAround, windowWith: windowWith,
    reachable: reachable, reaches: reaches
  };
})();
