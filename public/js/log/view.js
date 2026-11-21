/*
 * Render functions of the rapid log: header, day groups, rows. They build nodes and call back, they never fetch.
 * Needs ak-dom.js, copy.js, dates.js, glyph.js, days.js and inline/row.js.
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

  /** The pills after a title: tag and time (or "not synced"), then the sync dot (not for notes, which are never synced). */
  function pills(entry) {
    var text = L.days.metaText(entry);
    return h('span', { class: 'paper-meta' },
      text ? h('span', { class: 'meta-text' }, text) : h('span', { class: 'meta-text' }),
      L.days.showsSync(entry.type) ? L.glyph.syncMark(entry.sync) : null);
  }

  /** One entry as a tappable row: symbol, title and pills on one 24px line. The type, sync state, indent and id are on the row. */
  function entryRow(entry, onOpen, indent) {
    return h('button', {
      class: 'paper-row',
      type: 'button',
      'data-id': entry.id,
      'data-type': entry.type,
      'data-sync': entry.sync,
      'data-indent': String(indent === undefined ? entry.indent || 0 : indent),
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

  /** The rows of a day. The row being edited is swapped for the line, and a new line comes last in its day. The first row never nests. */
  function dayRows(day, actions, line) {
    var rows = day.entries.map(function (entry, index) {
      return line && line.id === entry.id ? L.inline.row.build(line, actions.typed) : entryRow(entry, actions.open, index === 0 ? 0 : entry.indent || 0);
    });
    if (line && line.isNew && line.home === day.date) rows.push(L.inline.row.build(line, actions.typed));
    return rows;
  }

  /** A day: its heading, its rows, and the add row when it is today. */
  function dayGroup(day, actions, line) {
    return h('section', { class: 'paper-day-group', 'data-date': day.date, 'data-today': day.isToday ? 'true' : null },
      dayHeader(day),
      dayRows(day, actions, line),
      day.isToday ? addRow(actions.add) : null);
  }

  /** All the days of the window, oldest first. line is the inline line being typed, or null. */
  function dayList(entries, today, actions, line) {
    return L.days.groupDays(entries, today).map(function (day) { return dayGroup(day, actions, line); });
  }

  /** A quiet line for loading, with a retry button after a failed load. */
  function stateNote(kind, onRetry) {
    var text = kind === 'error' ? L.copy.loadFailed : L.copy.loading;
    var note = h('p', { class: 'paper-state', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, text);
    if (kind !== 'error') return note;
    return h('div', null, note,
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: onRetry }, L.copy.retry));
  }

  L.view = { header: header, dayList: dayList, stateNote: stateNote, entryRow: entryRow };
})();
