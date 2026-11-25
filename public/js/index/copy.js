/*
 * Notebook index copy: every string the person reads on the notebook index (the list of known notebook pages by number), and the
 * entry point on the Notes screen. Plain JS, no build step. Needs log/copy.js (the month names).
 */
(function () {
  'use strict';

  var I = window.BujoIndex = window.BujoIndex || {};

  I.copy = {
    title: 'Notebook index',
    entry: 'Notebook index',
    entryCount: function (n) { return n === 1 ? '1 page' : n + ' pages'; },
    entryLabel: function (n) { return 'Open the notebook index, ' + (n === 1 ? '1 page' : n + ' pages'); },
    back: 'Notes',
    backLabel: 'Back to the notes',
    loading: 'Turning the page\u2026',
    loadFailed: 'Could not load the notebook index. Try again.',
    retry: 'Try again',
    offline: 'You\u2019re offline. The notebook index shows up here when you are back.',
    empty: 'No page numbers yet. Scan a page with a number, or give a collection one.',
    pageMark: function (n) { return 'p. ' + n; },
    openLabel: function (mark, label) { return 'Open ' + mark + ', ' + label; },
    monthLabel: function (month) { return L().copy.pages.picker.months[Number(month.slice(5, 7)) - 1] + ' ' + month.slice(0, 4); },
    shortMonth: function (month) { return L().copy.pages.picker.months[Number(month.slice(5, 7)) - 1].slice(0, 3) + ' ' + month.slice(0, 4); },
    futureLabel: function (month) { return 'Future log, from ' + I.copy.shortMonth(month); },
    dayLabel: function (weekday, date, page) { return weekday + ' ' + date.slice(8, 10) + '.' + date.slice(5, 7) + (page > 1 ? ', page ' + page : ''); }
  };

  function L() { return window.BujoLog; }
})();
