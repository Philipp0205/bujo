/*
 * Pure view model of the log: the entries of a day, the cards of a day, and the pills of an entry.
 * No DOM here. Words come from copy.js, pen hues from tags.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  /** The order of a day: by position, then by creation time for entries that share a position. */
  function byPosition(a, b) {
    return (a.position - b.position) || (a.createdAt - b.createdAt);
  }

  /** The horizon of an entry. Entries cached before horizons existed have none, and are day entries. */
  function horizonOf(entry) {
    return entry.horizon || 'day';
  }

  /** The entries of one day (day horizon only, a month or future item has its own list), in the order the server keeps them. Traces are not entries: see tracesOf. */
  function dayEntries(entries, date) {
    return entries.filter(function (entry) { return !entry.isTrace && entry.date === date && horizonOf(entry) === 'day'; }).sort(byPosition);
  }

  /** The entries of one group in server order: a day, or the month-task or future items filed under a month's last day. */
  function groupEntries(entries, horizon, date) {
    return entries.filter(function (entry) { return !entry.isTrace && entry.date === date && horizonOf(entry) === horizon; }).sort(byPosition);
  }

  /** The traces one move left on a page (a day, or a month lane), in the order they were left. They sit after the entries of the page. */
  function tracesOf(entries, horizon, date) {
    return entries.filter(function (entry) { return entry.isTrace === true && entry.date === date && horizonOf(entry) === horizon; })
      .sort(function (a, b) { return a.createdAt - b.createdAt; });
  }

  /** Whether an entry of this type has a sync state to show. Notes never go to CalDAV, so they show none. */
  function showsSync(type) {
    return type !== 'note';
  }

  /** Whether the sync dot shows: only for an entry that is not synced or failed. Not for a queued one (its pill says so) and never a note. */
  function showsMark(entry) {
    return !entry.queued && showsSync(entry.type) && (entry.sync === 'local' || entry.sync === 'error');
  }

  /** One tag pill per tag, in the order they were written, each with the pen hue of its word. */
  function tagPills(tags) {
    return (tags || []).map(function (tag) { return { kind: 'tag', text: tag, hue: L.tags.hueOf(tag) }; });
  }

  /** The pills under a title as { kind, text }: the tags, time, then "waiting to send" for a queued entry, or a quiet "not synced" for a local one without tags (never a note). */
  function entryPills(entry) {
    var pills = tagPills(entry.tags);
    if (entry.time) pills.push({ kind: 'time', text: entry.time, hue: 'ochre' });
    if (entry.queued) pills.push({ kind: 'queued', text: L.copy.queued, testid: 'waiting-to-send' });
    else if (!pills.some(function (pill) { return pill.kind === 'tag'; }) && entry.sync === 'local' && showsSync(entry.type)) pills.push({ kind: 'local', text: L.copy.notSynced });
    return pills;
  }

  /** The chips of a line being edited: its day or month when it differs from where it sits, then the tags and time. No sync words. */
  function editPills(line) {
    var pills = [];
    var horizon = line.horizon || 'day';
    var home = line.homeHorizon || 'day';
    if (horizon !== 'day' && (line.date !== line.home || horizon !== home)) {
      pills.push({ kind: 'date', text: L.copy.horizon.chip(line.date.slice(0, 7), line.home.slice(0, 4)) });
    } else if (horizon === 'day' && (line.date !== line.home || home !== 'day')) {
      pills.push({ kind: 'date', text: line.date.slice(8, 10) + '.' + line.date.slice(5, 7) });
    }
    pills = pills.concat(tagPills(line.tags));
    if (line.time) pills.push({ kind: 'time', text: line.time, hue: 'ochre' });
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
    horizonOf: horizonOf, dayEntries: dayEntries, groupEntries: groupEntries, tracesOf: tracesOf, cardsOf: cardsOf, showsSync: showsSync, showsMark: showsMark,
    entryPills: entryPills, editPills: editPills
  };
})();
