/*
 * Pure date helpers for the rapid log. A day is a YYYY-MM-DD string. No DOM, no fetch, no strings to show.
 * Arithmetic runs in UTC so a daylight saving change never skips or repeats a day.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  var BACK_DAYS = 6;
  var AHEAD_DAYS = 7;

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

  L.dates = { todayIso: todayIso, addDays: addDays, dayHeading: dayHeading, windowAround: windowAround };
})();
