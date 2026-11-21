/*
 * Pure view model of the log: entries grouped by day, and the pills (meta text) of an entry.
 * No DOM here. Words come from copy.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  /** The order of a day: by position, then by creation time for entries that share a position. */
  function byPosition(a, b) {
    return (a.position - b.position) || (a.createdAt - b.createdAt);
  }

  /** The entries of one day, in the order the server keeps them. */
  function dayEntries(entries, date) {
    return entries.filter(function (entry) { return entry.date === date; }).sort(byPosition);
  }

  /** Days in date order, each with its entries in order. Today is always there, even with no entries. */
  function groupDays(entries, today) {
    var dates = {};
    entries.forEach(function (entry) { dates[entry.date] = true; });
    dates[today] = true;
    return Object.keys(dates).sort().map(function (date) {
      return { date: date, isToday: date === today, entries: dayEntries(entries, date) };
    });
  }

  /** Whether an entry of this type has a sync state to show. Notes never go to CalDAV, so they show none. */
  function showsSync(type) {
    return type !== 'note';
  }

  /** The tag (or "not synced" for a local entry without one, never for a note), then the time, joined with a middle dot. */
  function metaText(entry) {
    var parts = [];
    if (entry.tag) parts.push(entry.tag);
    else if (entry.sync === 'local' && showsSync(entry.type)) parts.push(L.copy.notSynced);
    if (entry.time) parts.push(entry.time);
    return parts.join(' \u00b7 ');
  }

  /** The pills of a line being edited: its day when it differs from the day it sits in, then tag and time. No sync words. */
  function editPills(line) {
    var parts = [];
    if (line.date !== line.home) parts.push(line.date.slice(8, 10) + '.' + line.date.slice(5, 7));
    if (line.tag) parts.push(line.tag);
    if (line.time) parts.push(line.time);
    return parts.join(' \u00b7 ');
  }

  L.days = { groupDays: groupDays, dayEntries: dayEntries, metaText: metaText, showsSync: showsSync, editPills: editPills };
})();
