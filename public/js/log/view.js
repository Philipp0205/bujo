/*
 * Render functions of the daily log: header, the entries of a day, ink cards. They build nodes and call back, they never fetch.
 * actions: open(entry), add(), toggleDone(entry), migrate(), and select { on(), ticked(entry), toggle(entry) } for select mode.
 * Needs ak-dom.js, copy.js, dates.js, glyph.js, days.js, migrate/model.js, done/model.js, paper/recent.js and paper/view.js (the row mark and the header button).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};

  /** The page header: the italic title of the view, and the "Not on paper" button when entries wait to be written down. Scan and Add live in the tab bar. */
  function header(count, onOpenPaper, title) {
    return h('div', { class: 'paper-head' }, h('h1', null, title || L.copy.title), L.paper.view.control(count, onOpenPaper));
  }

  /** The "Today" mark next to the date of today. Its pen underline is drawn by the ink decorator. */
  function todayMark() {
    return h('span', { class: 'today', 'data-testid': 'today-mark' }, L.copy.today);
  }

  /** The inked words after a title: tags, time, "not synced", then the sync dot (local or failed only) and the not-on-paper page mark. Null when there is nothing to show. */
  function pills(entry, off) {
    var items = L.days.entryPills(entry).map(L.glyph.pill);
    var mark = L.days.showsMark(entry) ? L.glyph.syncMark(entry.sync) : null;
    var page = off ? L.paper.view.rowMark() : null;
    var words = items.concat(mark || [], page || []);
    if (!words.length) return null;
    return h('span', { class: 'paper-meta' }, spaced(words));
  }

  /** A plain space before each word, so the words can wrap onto the next line one by one (margins give no break). */
  function spaced(words) {
    return words.reduce(function (parts, word) { return parts.concat(' ', word); }, []);
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

  /** The part of a row that opens the entry: the title with its inked words after it in one button, so a keyboard or screen reader reaches it. */
  function openButton(entry, off) {
    return h('button', { class: 'paper-open', type: 'button', 'data-action': 'open-entry' },
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        pills(entry, off)));
  }

  /** The handwritten * in the margin before the bullet of an important entry, or null. It is a drawing only and takes no touches. */
  function star(entry) {
    if (!entry.important) return null;
    return h('span', { class: 'paper-star', 'data-testid': 'important-star', role: 'img', 'aria-label': L.copy.important.mark }, '*');
  }

  /** One entry as a row: the bullet (a done toggle for tasks), the title and inked words that open the edit sheet. A tap anywhere else on the row opens it too, or ticks it while selecting. */
  function entryRow(entry, actions, indent, today) {
    var picking = actions.select.on();
    var ticked = picking && actions.select.ticked(entry);
    return h('div', {
      class: 'paper-row',
      'data-id': entry.id,
      'data-type': entry.type,
      'data-horizon': entry.horizon || 'day',
      'data-sync': entry.sync,
      'data-queued': entry.queued || null,
      'data-on-paper': entry.onPaper ? 'true' : 'false',
      'data-important': entry.important ? 'true' : null,
      'data-indent': String(indent),
      'aria-selected': picking ? String(ticked) : null,
      onclick: tapOf(entry, actions)
    },
      picking ? ring(ticked) : null,
      star(entry),
      symbol(entry, actions),
      openButton(entry, L.paper.recent.shows(entry, today)));
  }

  /** The quiet "+ Add entry" row under the entries of the page on screen. Its empty space starts a line too. The label is a span, so the paper wash hugs the words only. */
  function addRow(onAdd) {
    return h('button', { class: 'paper-add', type: 'button', 'data-action': 'add-entry', onclick: onAdd },
      h('span', { class: 'paper-add-text' }, L.copy.addEntry));
  }

  /** One card: the entry on top, its nested entries inside the same card, each with its own pen outline (drawn by the ink decorator). */
  function entryCard(card, actions, today) {
    return h('article', { class: 'entry-card' },
      entryRow(card.entry, actions, 0, today),
      card.children.map(function (child) {
        return h('div', { class: 'card-child' }, entryRow(child, actions, 1, today));
      }));
  }

  /**
   * What a move left on a page: a muted row with the ">" or "<" glyph and the title as it was. It is no entry: no id, no toggle, no tap,
   * so the swipe, the long press and the page turn leave it alone, and it has no sync state.
   */
  function traceRow(trace) {
    return h('div', {
      class: 'paper-row paper-trace', 'data-type': trace.type, 'data-horizon': trace.horizon || 'day', 'data-testid': 'trace-row', 'data-trace': trace.type
    },
      h('span', { class: 'paper-sym', 'aria-label': L.copy.move.traceLabel[trace.type], role: 'img' }, L.glyph.typeGlyph(trace.type)),
      h('span', { class: 'paper-body' }, h('span', { class: 'paper-title' }, trace.title)));
  }

  /** The traces of a page as quiet rows after its cards. Null when there are none. */
  function traceList(traces) {
    return traces.length ? h('div', { class: 'paper-traces' }, traces.map(traceRow)) : null;
  }

  /** The quiet prompt at the top of today's page while earlier days hold open tasks: how many, and the way into the review. */
  function migratePrompt(count, onOpen) {
    return h('button', { class: 'paper-migrate paper-migrate-prompt', type: 'button', 'data-action': 'migrate-prompt', 'data-testid': 'migrate-prompt', onclick: onOpen },
      h('span', { class: 'paper-migrate-text' }, L.copy.migrate.prompt(count) + ' \u00b7 ', h('span', { class: 'paper-migrate-go' }, L.copy.migrate.promptAction)));
  }

  /** The always-there line under the entries of a daily page: opens the migration review even when nothing is waiting. */
  function migrateLink(onOpen) {
    return h('button', { class: 'paper-migrate', type: 'button', 'data-action': 'migrate-open', 'data-testid': 'migrate-open', onclick: onOpen },
      h('span', { class: 'paper-migrate-text' }, L.copy.migrate.link));
  }

  /** The quiet break where the next physical page of the day starts: a dashed ink line with the page number. It is a drawing only and takes no touches. */
  function pageBreak(page) {
    var text = L.copy.paperPage.break(page);
    return h('div', { class: 'page-break', 'data-testid': 'page-break', 'data-page': String(page), role: 'separator', 'aria-label': text },
      h('span', { class: 'page-break-text' }, text));
  }

  /** One card of a day, with the page break above it when it is the first line of a later physical page. */
  function dayCard(card, actions, today) {
    return [card.startsPage ? pageBreak(card.startsPage) : null, entryCard(card, actions, today)];
  }

  /** The entries of one day: the migrate prompt (today only), a card per top-level entry, the traces of moves, then the add row and migrate link (not while selecting). The date heading is on the page's date row. */
  function dayPage(date, entries, actions, today) {
    var waiting = date === today ? L.migrate.model.open(entries, today).length : 0;
    var picking = actions.select.on();
    return h('section', { class: 'paper-day-group', 'data-date': date },
      waiting && !picking ? migratePrompt(waiting, actions.migrate) : null,
      L.days.cardsOf(L.days.dayEntries(entries, date)).map(function (card) { return dayCard(card, actions, today); }),
      traceList(L.days.tracesOf(entries, 'day', date)),
      picking ? null : addRow(actions.add),
      picking ? null : migrateLink(actions.migrate));
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

  L.view = {
    header: header, todayMark: todayMark, dayPage: dayPage, stateNote: stateNote, offlineHint: offlineHint, entryCard: entryCard, addRow: addRow,
    traceList: traceList
  };
})();
