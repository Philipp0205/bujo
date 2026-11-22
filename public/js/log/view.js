/*
 * Render functions of the rapid log: header, day groups, ink cards. They build nodes and call back, they never fetch.
 * actions: open(entry), add(), and select { on(), ticked(entry), toggle(entry) } for select mode.
 * Needs ak-dom.js, copy.js, dates.js, glyph.js, days.js, paper/recent.js and paper/view.js (the row mark and the header button).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};

  /** The page header: the italic title, and the "Not on paper" button when entries wait to be written down. Scan and Settings live in the tab bar. */
  function header(count, onOpenPaper) {
    return h('div', { class: 'paper-head' }, h('h1', null, L.copy.title), L.paper.view.control(count, onOpenPaper));
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

  /** The ink ring in front of a row while selecting: a pen circle, with a tick inside when the entry is ticked. */
  function ring(ticked) {
    return h('span', { class: 'select-check', 'data-testid': 'select-check', 'data-checked': ticked ? 'true' : 'false' },
      L.glyph.use('g-ring', { width: 24, height: 24, viewBox: '0 0 24 24' }),
      ticked ? L.glyph.use('g-check', { width: 24, height: 24, viewBox: '0 0 24 24' }) : null);
  }

  /** What a tap on a row does: ticks it while selecting, otherwise opens it. */
  function tapOf(entry, actions) {
    return function () {
      if (actions.select.on()) actions.select.toggle(entry);
      else actions.open(entry);
    };
  }

  /** One entry as a tappable row: the symbol in its own column, the title, and the pills under the title. Opens the edit sheet, or ticks while selecting. The page mark shows for a recent entry that is not on paper. */
  function entryRow(entry, actions, indent, today) {
    var picking = actions.select.on();
    var ticked = picking && actions.select.ticked(entry);
    return h('button', {
      class: 'paper-row',
      type: 'button',
      'data-id': entry.id,
      'data-type': entry.type,
      'data-sync': entry.sync,
      'data-on-paper': entry.onPaper ? 'true' : 'false',
      'data-indent': String(indent),
      'aria-selected': picking ? String(ticked) : null,
      onclick: tapOf(entry, actions)
    },
      picking ? ring(ticked) : null,
      h('span', { class: 'paper-sym', 'aria-label': L.copy.typeLabels[entry.type], role: 'img' }, L.glyph.typeGlyph(entry.type)),
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        pills(entry)),
      L.paper.recent.shows(entry, today) ? L.paper.view.rowMark() : null);
  }

  /** The quiet "+ Add entry" row under today's entries. Its empty space starts a line too. */
  function addRow(onAdd) {
    return h('button', { class: 'paper-add', type: 'button', 'data-action': 'add-entry', onclick: onAdd }, L.copy.addEntry);
  }

  /** One card: the entry on top, its nested entries inside the same card, each with its own pen outline (drawn by the ink decorator). */
  function entryCard(card, actions, today) {
    return h('article', { class: 'entry-card' },
      entryRow(card.entry, actions, 0, today),
      card.children.map(function (child) {
        return h('div', { class: 'card-child' }, entryRow(child, actions, 1, today));
      }));
  }

  /** A day: its heading, a card per top-level entry, and the add row when it is today (not while selecting). */
  function dayGroup(day, actions, today) {
    return h('section', { class: 'paper-day-group', 'data-date': day.date, 'data-today': day.isToday ? 'true' : null },
      dayHeader(day),
      L.days.cardsOf(day.entries).map(function (card) { return entryCard(card, actions, today); }),
      day.isToday && !actions.select.on() ? addRow(actions.add) : null);
  }

  /** All the days of the window, oldest first. */
  function dayList(entries, today, actions) {
    return L.days.groupDays(entries, today).map(function (day) { return dayGroup(day, actions, today); });
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
