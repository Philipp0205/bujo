/*
 * Date suggestions for a written "@" word. Pure: no DOM, no fetch. Needs fuzzy.js, date-token.js, dates.js and copy.js.
 *
 * For the text after the "@" (empty, "mo", "morg", "23", "23.11") it lists up to six days, each as
 * { iso, label: "Mo 23.11.", hint: "morgen", insert: "@23.11." }. The label shows the weekday and the day (with the year
 * when it is not this year). The insert is the canonical written form: "@dd.mm." this year, "@dd.mm.yyyy" otherwise,
 * so the same day is never read two ways. Words match by prefix after folding (so "uber" finds "übermorgen").
 * suggestMonths(query, today) lists whole months for a name prefix ("de", "dez", "dec") or "mm.yyyy", each as
 * { month: "2026-12", label: "December", hint: "whole month", insert: "@dezember" } ("@12.2027" when the year is not this one).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.suggest = L.suggest || {};

  var LIMIT = 6;
  var RELATIVE = ['heute', 'morgen', '\u00fcbermorgen'];
  var WEEKDAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
  var SHORT = { montag: 'mo', dienstag: 'di', mittwoch: 'mi', donnerstag: 'do', freitag: 'fr', samstag: 'sa', sonntag: 'so' };
  /** The names a month answers to, German first (the first one is what a suggestion inserts), then English. */
  var MONTHS = [
    ['januar', 'january'], ['februar', 'february'], ['m\u00e4rz', 'march'], ['april'], ['mai', 'may'], ['juni', 'june'],
    ['juli', 'july'], ['august'], ['september'], ['oktober', 'october'], ['november'], ['dezember', 'december']
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** The weekday label of a day: Mo Di Mi Do Fr Sa So. */
  function weekdayOf(iso) {
    var day = new Date(iso + 'T00:00:00Z').getUTCDay();
    return L.copy.suggest.weekdays[day];
  }

  /** "23.11." for a day this year, "23.11.2027" for another year. */
  function written(iso, today) {
    var text = iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.';
    return iso.slice(0, 4) === today.slice(0, 4) ? text : text + iso.slice(0, 4);
  }

  /** One suggestion for a day. hint is the word that found it ("morgen", "Montag"), or ''. */
  function make(iso, today, hint) {
    var text = written(iso, today);
    return { iso: iso, label: weekdayOf(iso) + ' ' + text, hint: hint, insert: '@' + text };
  }

  /** The words a query can name: the relative words and the weekdays, each with the day it stands for. */
  function words(today) {
    var list = RELATIVE.map(function (word, index) {
      return { name: word, short: '', iso: L.dateToken.addDays(today, index), hint: L.copy.suggest.relative[word] };
    });
    WEEKDAYS.forEach(function (word) {
      var iso = L.dateToken.of('@' + word, today);
      list.push({ name: word, short: SHORT[word], iso: iso, hint: L.copy.suggest.weekdayNames[word] });
    });
    return list;
  }

  /** True when the query names the word: a prefix of it, or its two-letter short form. */
  function names(query, word) {
    var fold = L.suggest.fuzzy.fold;
    return fold(word.name).indexOf(query) === 0 || word.short === query;
  }

  /** The words a query names, exact short forms first ("mo" lists Montag before Morgen). */
  function byWord(query, today) {
    var found = words(today).filter(function (word) { return query === '' || names(L.suggest.fuzzy.fold(query), word); });
    var exact = found.filter(function (word) { return word.short === query.toLowerCase(); });
    return exact.concat(found.filter(function (word) { return exact.indexOf(word) < 0; }));
  }

  /** A day of the month alone ("23"): that day this month when it is still ahead, else next month's (skipping months without it). */
  function byDayOfMonth(day, today) {
    var year = Number(today.slice(0, 4));
    var month = Number(today.slice(5, 7));
    for (var step = 0; step < 14; step++) {
      var iso = (year + Math.floor((month - 1 + step) / 12)) + '-' + pad(((month - 1 + step) % 12) + 1) + '-' + pad(day);
      var found = L.dateToken.of('@' + pad(day) + '.' + iso.slice(5, 7) + '.' + iso.slice(0, 4), today);
      if (found && found >= today) return found;
    }
    return null;
  }

  /** The day a numeric query ("23", "23.", "23.11", "23.11.2027") stands for, or null. */
  function byNumber(query, today) {
    var day = /^(\d{1,2})\.?$/.exec(query);
    if (day) return byDayOfMonth(Number(day[1]), today);
    return L.dateToken.of('@' + query, today);
  }

  /** Up to six suggestions for the text after "@". today is YYYY-MM-DD. */
  function suggest(query, today) {
    var out = [];
    function push(iso, hint) {
      if (iso && !out.some(function (item) { return item.iso === iso; })) out.push(make(iso, today, hint));
    }
    if (/^\d/.test(query)) push(byNumber(query, today), '');
    else byWord(query, today).forEach(function (word) { push(word.iso, word.hint); });
    return out.slice(0, LIMIT);
  }

  /** The months whose German or English name starts with the query (folded), in calendar order, as month numbers 1 to 12. */
  function monthsNamed(query) {
    var fold = L.suggest.fuzzy.fold;
    var wanted = fold(query);
    var found = [];
    MONTHS.forEach(function (names, index) {
      if (names.some(function (name) { return fold(name).indexOf(wanted) === 0; })) found.push(index + 1);
    });
    return found;
  }

  /** One suggestion for a month: { month: YYYY-MM, label, hint, insert }. The year shows in the label and the insert when it is not this year. */
  function makeMonth(month, today) {
    var number = Number(month.slice(5, 7));
    var other = month.slice(0, 4) !== today.slice(0, 4);
    var name = L.copy.pages.picker.months[number - 1];
    return {
      month: month, label: other ? name + ' ' + month.slice(0, 4) : name, hint: L.copy.suggest.monthHint,
      insert: other ? '@' + pad(number) + '.' + month.slice(0, 4) : '@' + MONTHS[number - 1][0]
    };
  }

  /** Month suggestions for the text after "@": a name prefix ("de", "dez", "dec"), or a written "mm.yyyy". Never for an empty query. */
  function suggestMonths(query, today) {
    var numeric = /^\d{1,2}\.\d{4}$/.test(query);
    if (query === '' || (/^\d/.test(query) && !numeric)) return [];
    var keys = numeric ? [L.dateToken.monthOf('@' + query, today)] : monthsNamed(query).map(function (number) {
      return L.dateToken.monthOf('@' + MONTHS[number - 1][0], today);
    });
    return keys.filter(Boolean).map(function (month) { return makeMonth(month, today); });
  }

  L.suggest.dates = { suggest: suggest, suggestMonths: suggestMonths };
})();
