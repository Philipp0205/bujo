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
    dropped: '~',
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

  /** The header of a month group, like "Dezember 2026". */
  function monthHeading(date) {
    return L.copy.clip.months[Number(date.slice(5, 7)) - 1] + ' ' + date.slice(0, 4);
  }

  /** The groups the entries sit in, in date order with a day before the month items of the same date: { date, month, entries }. */
  function groupsOf(entries) {
    var seen = {};
    entries.forEach(function (entry) {
      var month = !L.days.hasDay(L.days.horizonOf(entry));
      seen[(month ? 'm' : 'd') + entry.date] = { date: entry.date, month: month };
    });
    return Object.keys(seen).map(function (key) { return seen[key]; }).sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.month) - Number(b.month);
    }).map(function (group) {
      var items = group.month
        ? L.days.groupEntries(entries, 'month-task', group.date).concat(L.days.groupEntries(entries, 'future', group.date))
        : L.days.dayItems(entries, group.date);
      return { date: group.date, month: group.month, entries: items };
    });
  }

  /** The text of the entries: lines in group order then position, with a header per day or month when there is more than one group. */
  function format(entries) {
    var groups = groupsOf(entries);
    return groups.map(function (group) {
      var head = group.month ? monthHeading(group.date) : heading(group.date);
      return (groups.length > 1 ? [head] : []).concat(group.entries.map(line)).join('\n');
    }).join('\n\n');
  }

  L.clip = { format: format };
})();
