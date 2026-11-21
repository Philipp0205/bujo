/*
 * Render functions of the rapid log: header, day groups, ink cards. They build nodes and call back, they never fetch.
 * Needs ak-dom.js, copy.js, dates.js, glyph.js and days.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};

  /** The page header: just the italic title. Scan and Settings live in the tab bar. */
  function header() {
    return h('div', { class: 'paper-head' }, h('h1', null, L.copy.title));
  }

  /** The "Today" mark next to the date of today. Its pen underline is drawn by the ink decorator. */
  function todayMark() {
    return h('span', { class: 'today', 'data-testid': 'today-mark' }, L.copy.today);
  }

  /** The heading of a day, like "Friday 20.11", with the today mark on today. */
  function dayHeader(day) {
    return h('h2', { class: 'paper-day', 'data-date': day.date },
      L.dates.dayHeading(day.date),
      day.isToday ? todayMark() : null);
  }

  /** The pills under a title: tag, time, "not synced", then the sync dot (local or failed only). Null when there is nothing to show. */
  function pills(entry) {
    var items = L.days.entryPills(entry).map(L.glyph.pill);
    var mark = L.days.showsMark(entry) ? L.glyph.syncMark(entry.sync) : null;
    if (!items.length && !mark) return null;
    return h('span', { class: 'paper-meta' }, items, mark);
  }

  /** One entry as a tappable row: the symbol in its own column, the title, and the pills under the title. Opens the edit sheet. */
  function entryRow(entry, onOpen, indent) {
    return h('button', {
      class: 'paper-row',
      type: 'button',
      'data-id': entry.id,
      'data-type': entry.type,
      'data-sync': entry.sync,
      'data-indent': String(indent),
      onclick: function () { onOpen(entry); }
    },
      h('span', { class: 'paper-sym', 'aria-label': L.copy.typeLabels[entry.type], role: 'img' }, L.glyph.typeGlyph(entry.type)),
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        pills(entry)));
  }

  /** The quiet "+ Add entry" row under today's entries. Its empty space starts a line too. */
  function addRow(onAdd) {
    return h('button', { class: 'paper-add', type: 'button', 'data-action': 'add-entry', onclick: onAdd }, L.copy.addEntry);
  }

  /** One card: the entry on top, its nested entries inside the same card, each with its own pen outline (drawn by the ink decorator). */
  function entryCard(card, actions) {
    return h('article', { class: 'entry-card' },
      entryRow(card.entry, actions.open, 0),
      card.children.map(function (child) {
        return h('div', { class: 'card-child' }, entryRow(child, actions.open, 1));
      }));
  }

  /** A day: its heading, a card per top-level entry, and the add row when it is today. */
  function dayGroup(day, actions) {
    return h('section', { class: 'paper-day-group', 'data-date': day.date, 'data-today': day.isToday ? 'true' : null },
      dayHeader(day),
      L.days.cardsOf(day.entries).map(function (card) { return entryCard(card, actions); }),
      day.isToday ? addRow(actions.add) : null);
  }

  /** All the days of the window, oldest first. */
  function dayList(entries, today, actions) {
    return L.days.groupDays(entries, today).map(function (day) { return dayGroup(day, actions); });
  }

  /** A quiet line for loading, with a retry button after a failed load. */
  function stateNote(kind, onRetry) {
    var text = kind === 'error' ? L.copy.loadFailed : L.copy.loading;
    var note = h('p', { class: 'paper-state', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, text);
    if (kind !== 'error') return note;
    return h('div', null, note,
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: onRetry }, L.copy.retry));
  }

  L.view = { header: header, dayList: dayList, stateNote: stateNote };
})();
