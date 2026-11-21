/*
 * Pure view model of the log: entries grouped by day, and the pills (meta text) of an entry.
 * No DOM here. Words come from copy.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  /** Days in date order, each with its entries. Today is always there, even with no entries. */
  function groupDays(entries, today) {
    var byDate = {};
    entries.forEach(function (entry) {
      (byDate[entry.date] = byDate[entry.date] || []).push(entry);
    });
    if (!byDate[today]) byDate[today] = [];
    return Object.keys(byDate).sort().map(function (date) {
      return { date: date, isToday: date === today, entries: byDate[date] };
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

  L.days = { groupDays: groupDays, metaText: metaText, showsSync: showsSync, editPills: editPills };
})();
