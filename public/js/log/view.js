/*
 * Render functions of the rapid log: header, day groups, rows. They build nodes and call back, they never fetch.
 * Needs ak-dom.js, copy.js, dates.js, glyph.js and days.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};

  /** The page header: the italic title, the scan button and the settings link. */
  function header(onScan) {
    var copy = L.copy;
    var scan = h('button', {
      class: 'ak-icon-btn',
      type: 'button',
      'aria-label': copy.scanLabel,
      title: copy.scanLabel,
      'data-action': 'scan',
      onclick: onScan
    }, L.glyph.use('g-camera', { width: 24, height: 24, viewBox: '0 0 24 24' }));
    var settings = h('a', {
      class: 'ak-icon-btn',
      href: '/settings',
      'aria-label': copy.settingsLabel,
      'data-nav': 'settings'
    }, L.glyph.use('g-settings', { width: 24, height: 24, viewBox: '0 0 24 24' }));
    return h('div', { class: 'paper-head' },
      h('h1', null, copy.title),
      h('div', { class: 'paper-actions' }, scan, settings));
  }

  /** The hand-underlined "Today" mark next to the date of today. */
  function todayMark() {
    return h('span', { class: 'today', 'data-testid': 'today-mark' },
      L.copy.today,
      L.glyph.use('g-today', { viewBox: '0 0 40 6', preserveAspectRatio: 'none' }));
  }

  /** The heading of a day, like "Friday 20.11", with the today mark on today. */
  function dayHeader(day) {
    return h('h2', { class: 'paper-day', 'data-date': day.date },
      L.dates.dayHeading(day.date),
      day.isToday ? todayMark() : null);
  }

  /** The grey line under a title: tag and time, then the sync dot. */
  function metaLine(entry) {
    return h('span', { class: 'paper-meta' },
      h('span', { class: 'meta-text' }, L.days.metaText(entry)),
      L.glyph.syncMark(entry.sync));
  }

  /** One entry as a tappable row. The type, sync state and id are on the row so tests and styles can find it. */
  function entryRow(entry, onOpen) {
    return h('button', {
      class: 'paper-row',
      type: 'button',
      'data-id': entry.id,
      'data-type': entry.type,
      'data-sync': entry.sync,
      onclick: function () { onOpen(entry); }
    },
      h('span', { class: 'paper-sym', 'aria-label': L.copy.typeLabels[entry.type], role: 'img' }, L.glyph.typeGlyph(entry.type)),
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        metaLine(entry)));
  }

  /** The quiet "+ Add entry" row under today's entries. */
  function addRow(onAdd) {
    return h('button', { class: 'paper-add', type: 'button', 'data-action': 'add-entry', onclick: onAdd }, L.copy.addEntry);
  }

  /** A day: its heading, its rows, and the add row when it is today. */
  function dayGroup(day, actions) {
    return h('section', { class: 'paper-day-group', 'data-date': day.date },
      dayHeader(day),
      day.entries.map(function (entry) { return entryRow(entry, actions.open); }),
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
