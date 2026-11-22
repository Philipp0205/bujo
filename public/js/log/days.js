/*
 * Pure view model of the log: entries grouped by day, the cards of a day, and the pills of an entry.
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

  /** Whether the sync dot shows: only for an entry that is not synced or failed. Not for a queued one (its pill says so) and never a note. */
  function showsMark(entry) {
    return !entry.queued && showsSync(entry.type) && (entry.sync === 'local' || entry.sync === 'error');
  }

  /** One tag pill per tag, in the order they were written. */
  function tagPills(tags) {
    return (tags || []).map(function (tag) { return { kind: 'tag', text: tag }; });
  }

  /** The pills under a title as { kind, text }: the tags, time, then "waiting to send" for a queued entry, or a quiet "not synced" for a local one without tags (never a note). */
  function entryPills(entry) {
    var pills = tagPills(entry.tags);
    if (entry.time) pills.push({ kind: 'time', text: entry.time });
    if (entry.queued) pills.push({ kind: 'queued', text: L.copy.queued, testid: 'waiting-to-send' });
    else if (!pills.some(function (pill) { return pill.kind === 'tag'; }) && entry.sync === 'local' && showsSync(entry.type)) pills.push({ kind: 'local', text: L.copy.notSynced });
    return pills;
  }

  /** The chips of a line being edited: its day when it differs from the day it sits in, then the tags and time. No sync words. */
  function editPills(line) {
    var pills = [];
    if (line.date !== line.home) pills.push({ kind: 'date', text: line.date.slice(8, 10) + '.' + line.date.slice(5, 7) });
    pills = pills.concat(tagPills(line.tags));
    if (line.time) pills.push({ kind: 'time', text: line.time });
    return pills;
  }

  /** The cards of a day: each top-level entry with the entries nested under it. The first entry of a day never nests. */
  function cardsOf(entries) {
    var cards = [];
    entries.forEach(function (entry, index) {
      if (index > 0 && entry.indent === 1) cards[cards.length - 1].children.push(entry);
      else cards.push({ entry: entry, children: [] });
    });
    return cards;
  }

  L.days = {
    groupDays: groupDays, dayEntries: dayEntries, cardsOf: cardsOf, showsSync: showsSync, showsMark: showsMark,
    entryPills: entryPills, editPills: editPills
  };
})();
