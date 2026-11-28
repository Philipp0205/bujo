/*
 * The notebook page number of a day, read from the page index (/api/index) and kept here. No DOM. Needs api.js.
 * forDay(date) is the number written on the paper for the day (its first physical page), or 0 when unknown.
 * load() reads the index again. It never rejects: a failed read keeps the numbers it had.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  var byDay = {};

  /** The first numbered physical page of each day, from the index pages (kinds other than day are ignored). */
  function mapDays(pages) {
    var out = {};
    var firstPage = {};
    (pages || []).forEach(function (page) {
      if (page.kind !== 'day' || !(page.number > 0)) return;
      if (firstPage[page.ref] === undefined || page.page < firstPage[page.ref]) {
        firstPage[page.ref] = page.page;
        out[page.ref] = page.number;
      }
    });
    return out;
  }

  /** The notebook page number of a day, or 0 when it is not known. */
  function forDay(date) {
    return byDay[date] || 0;
  }

  /** Reads the page index and keeps the day numbers. Always resolves. */
  function load() {
    return L.api.listIndex().then(function (pages) { byDay = mapDays(pages); }, function () {});
  }

  L.pages.number = { mapDays: mapDays, forDay: forDay, load: load };
})();
