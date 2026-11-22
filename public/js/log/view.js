/*
 * Render functions of the daily log: header, the entries of a day, ink cards. They build nodes and call back, they never fetch.
 * actions: open(entry), add(), toggleDone(entry), and select { on(), ticked(entry), toggle(entry) } for select mode.
 * Needs ak-dom.js, copy.js, dates.js, glyph.js, days.js, done/model.js, paper/recent.js and paper/view.js (the row mark and the header button).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};

  /** The page header: the italic title, and the "Not on paper" button when entries wait to be written down. Scan and Add live in the tab bar. */
  function header(count, onOpenPaper) {
    return h('div', { class: 'paper-head' }, h('h1', null, L.copy.title), L.paper.view.control(count, onOpenPaper));
  }

  /** The "Today" mark next to the date of today. Its pen underline is drawn by the ink decorator. */
  function todayMark() {
    return h('span', { class: 'today', 'data-testid': 'today-mark' }, L.copy.today);
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

  /** The bullet of a task or done row: a tap flips it done or not done. While selecting it is just part of the row (the tap bubbles up and ticks). */
  function toggleButton(entry, actions) {
    return h('button', {
      class: 'paper-sym paper-sym-btn',
      type: 'button',
      'data-testid': 'toggle-done',
      'aria-label': L.copy.done.toggle[entry.type],
      onclick: function (event) {
        if (actions.select.on()) return;
        event.stopPropagation();
        actions.toggleDone(entry);
      }
    }, L.glyph.typeGlyph(entry.type));
  }

  /** The symbol column: a done toggle for a task or done entry, a plain labelled glyph for every other type. */
  function symbol(entry, actions) {
    if (L.done.model.canToggle(entry)) return toggleButton(entry, actions);
    return h('span', { class: 'paper-sym', 'aria-label': L.copy.typeLabels[entry.type], role: 'img' }, L.glyph.typeGlyph(entry.type));
  }

  /** The part of a row that opens the entry: title and pills in one button, so a keyboard or screen reader reaches it. */
  function openButton(entry) {
    return h('button', { class: 'paper-open', type: 'button', 'data-action': 'open-entry' },
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        pills(entry)));
  }

  /** One entry as a row: the bullet (a done toggle for tasks), the title and pills that open the edit sheet, and the page mark. A tap anywhere else on the row opens it too, or ticks it while selecting. */
  function entryRow(entry, actions, indent, today) {
    var picking = actions.select.on();
    var ticked = picking && actions.select.ticked(entry);
    return h('div', {
      class: 'paper-row',
      'data-id': entry.id,
      'data-type': entry.type,
      'data-sync': entry.sync,
      'data-queued': entry.queued || null,
      'data-on-paper': entry.onPaper ? 'true' : 'false',
      'data-indent': String(indent),
      'aria-selected': picking ? String(ticked) : null,
      onclick: tapOf(entry, actions)
    },
      picking ? ring(ticked) : null,
      symbol(entry, actions),
      openButton(entry),
      L.paper.recent.shows(entry, today) ? L.paper.view.rowMark() : null);
  }

  /** The quiet "+ Add entry" row under the entries of the page on screen. Its empty space starts a line too. */
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

  /** The entries of one day: a card per top-level entry, then the add row (not while selecting). The date heading is on the page's date row. */
  function dayPage(date, entries, actions, today) {
    return h('section', { class: 'paper-day-group', 'data-date': date },
      L.days.cardsOf(L.days.dayEntries(entries, date)).map(function (card) { return entryCard(card, actions, today); }),
      actions.select.on() ? null : addRow(actions.add));
  }

  /** The quiet line above the days while the device is offline. */
  function offlineHint() {
    return h('p', { class: 'paper-hint', 'data-testid': 'offline-hint', role: 'status' }, L.copy.offline.hint);
  }

  /** A quiet line for loading, with a retry button after a failed load. */
  function stateNote(kind, onRetry) {
    var text = kind === 'error' ? L.copy.loadFailed : L.copy.loading;
    var note = h('p', { class: 'paper-state', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, text);
    if (kind !== 'error') return note;
    return h('div', null, note,
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: onRetry }, L.copy.retry));
  }

  L.view = { header: header, todayMark: todayMark, dayPage: dayPage, stateNote: stateNote, offlineHint: offlineHint };
})();
