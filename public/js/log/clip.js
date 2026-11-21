/*
 * The clipboard text of rapid-log entries: one paper line per entry, like the bullets of a bullet journal page.
 * Pure: no DOM, no clipboard. Needs copy.js (the German weekday names) and days.js (the order of a day).
 *
 *   {symbol} {title}{ #tag}...{ HH:MM}
 *
 * Titles and tags are copied exactly as stored. Entries on one day have no header. Entries on several days are
 * grouped under "Montag 23.11." with a blank line between the groups. Nesting is not written: every line starts at the margin.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  /** The bullet of each entry type: the inverse of SYMBOL_TYPES in src/log/scan/parse.ts, so a paste reads like a scanned page. */
  var SYMBOLS = {
    task: '\u2022',
    done: 'x',
    migrated: '>',
    scheduled: '<',
    event: '\u25cb',
    note: '\u2013'
  };

  /** One line: the bullet, the title, each tag as " #tag", and the time. */
  function line(entry) {
    var text = SYMBOLS[entry.type] + ' ' + entry.title;
    (entry.tags || []).forEach(function (tag) { text += ' #' + tag; });
    if (entry.time) text += ' ' + entry.time;
    return text;
  }

  /** The header of a day, like "Montag 23.11.". UTC arithmetic, so a daylight saving change never moves the weekday. */
  function heading(iso) {
    var parts = iso.split('-').map(Number);
    var weekday = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    return L.copy.clip.weekdays[weekday] + ' ' + iso.slice(8, 10) + '.' + iso.slice(5, 7) + '.';
  }

  /** The days the entries sit on, in date order. */
  function datesOf(entries) {
    var seen = {};
    entries.forEach(function (entry) { seen[entry.date] = true; });
    return Object.keys(seen).sort();
  }

  /** The text of the entries: lines in day order then position, with a header per day when there is more than one day. */
  function format(entries) {
    var dates = datesOf(entries);
    var groups = dates.map(function (date) {
      var lines = L.days.dayEntries(entries, date).map(line);
      return (dates.length > 1 ? [heading(date)] : []).concat(lines).join('\n');
    });
    return groups.join('\n\n');
  }

  L.clip = { format: format };
})();
