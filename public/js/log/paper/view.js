/*
 * Render functions of the "not on paper" list: the sheet, a day or a month with its rows, a row with its "Mark as written" button.
 * They build nodes and call back, they never fetch. Needs ak-dom.js, copy.js, dates.js, days.js, glyph.js, paper/model.js, migrate/model.js and migrate/choices.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  /** The tag and time words after a title. The list is about the paper, so the sync words stay out of it. */
  function pills(entry) {
    var items = L.days.entryPills(entry).filter(function (item) { return item.kind !== 'local'; });
    var words = items.reduce(function (parts, item) { return parts.concat(' ', L.glyph.pill(item)); }, []);
    return items.length ? h('span', { class: 'paper-meta' }, words) : null;
  }

  /** The choices of a row that can be migrated (an open task of an earlier day: the review's own rule), else nothing. */
  function choices(entry, handlers) {
    if (!L.migrate.model.reviewable(entry, handlers.today)) return null;
    return L.migrate.choices.view(handlers.busy, function (action) { handlers.decide(entry, action); });
  }

  /** One entry: its symbol, title and inked words, the migration choices when it has them, and the button that says it is written down now. */
  function row(entry, handlers) {
    return h('div', { class: 'todo-row', 'data-id': entry.id, 'data-type': entry.type, 'data-testid': 'not-on-paper-row' },
      h('span', { class: 'paper-sym', role: 'img', 'aria-label': L.copy.typeLabels[entry.type] }, L.glyph.typeGlyph(entry.type)),
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        pills(entry),
        choices(entry, handlers),
        h('button', { class: 'todo-written', type: 'button', 'data-action': 'mark-written', onclick: function () { handlers.written(entry); } }, L.copy.paper.written)));
  }

  /** A day or a month: its heading and its rows. A month group is headed by the month name. */
  function day(group, handlers) {
    var head = group.month
      ? h('h3', { class: 'todo-day-head', 'data-testid': 'not-on-paper-month' }, L.copy.horizon.monthName(group.date.slice(0, 7)))
      : h('h3', { class: 'todo-day-head', 'data-testid': 'not-on-paper-day' }, L.dates.dayHeading(group.date));
    return h('section', { class: 'todo-day', 'data-date': group.date, 'data-horizon': group.month ? 'month' : 'day' },
      head,
      group.entries.map(function (entry) { return row(entry, handlers); }));
  }

  /** A quiet line: the loading note, the failure, or "Everything is on paper." */
  function note(text, kind) {
    return h('p', { class: 'todo-note', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, text);
  }

  /** The offer after the last entry was written down: a prompt, the Scan button and a quiet "Not now". */
  function offer(actions) {
    return h('div', { class: 'todo-offer', 'data-testid': 'scan-offer' },
      h('p', { class: 'todo-offer-text', 'data-testid': 'scan-offer-prompt' }, L.copy.paper.offerPrompt),
      h('div', { class: 'todo-offer-actions' },
        h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-testid': 'scan-offer-scan', onclick: actions.onScan }, L.copy.paper.offerScan),
        h('button', { class: 'todo-offer-dismiss', type: 'button', 'data-testid': 'scan-offer-dismiss', onclick: actions.onDismiss }, L.copy.paper.offerDismiss)));
  }

  /** What the scroll area shows for a status: the days with their rows, or a note (with the scan offer when asked for). handlers: today, busy, written(entry), decide(entry, action). */
  function content(state, handlers) {
    if (state.status === 'loading') return note(L.copy.loading, 'loading');
    if (state.status === 'error') return note(L.copy.paper.failed, 'error');
    if (!state.entries.length) return [note(L.copy.paper.empty, 'empty'), state.offer ? offer(state.offerActions) : null].filter(Boolean);
    return L.paper.model.groups(state.entries).map(function (group) { return day(group, handlers); });
  }

  /** The line under the sheet title: how many entries are left to write down. */
  function subText(state) {
    return state.status === 'ready' && state.entries.length ? L.copy.paper.sub(state.entries.length) : L.copy.paper.subEmpty;
  }

  /** The sheet node with the parts the controller redraws: the sub line, the scroll slot, the Copy all and the Migrate buttons. */
  function shell(onCopyAll, onMigrate) {
    var parts = {
      sub: h('p', { class: 'sheet-sub', 'data-testid': 'not-on-paper-sub' }),
      slot: h('div', { class: 'todo-list', 'data-testid': 'not-on-paper-list' }),
      copy: h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-testid': 'copy-all', onclick: onCopyAll }, L.copy.paper.copyAll),
      migrate: h('button', { class: 'ak-btn', type: 'button', hidden: true, 'data-testid': 'not-on-paper-migrate', onclick: onMigrate }, L.copy.paper.migrate)
    };
    parts.node = h('div', {
      class: 'ak-sheet todo-sheet sheet-entry sheet-scan',
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'todo-heading', 'data-testid': 'not-on-paper-sheet'
    },
      h('div', { class: 'ak-sheet-head' },
        h('div', { class: 'ak-grabber' }),
        h('h2', { class: 'sheet-title', id: 'todo-heading' }, L.copy.paper.heading),
        parts.sub),
      h('div', { class: 'ak-sheet-scroll' }, parts.slot),
      h('div', { class: 'ak-sheet-dock' }, parts.copy, parts.migrate));
    return parts;
  }

  /** The small page mark after a title that is not on paper yet. It sits inside the title's inked words (log view.js), so it flows with them. */
  function rowMark() {
    return h('span', { class: 'paper-off', 'data-testid': 'not-on-paper-mark', role: 'img', 'aria-label': L.copy.paper.mark, title: L.copy.paper.mark },
      L.glyph.use('g-unwritten', { width: 16, height: 16, viewBox: '0 0 16 16' }));
  }

  /** The header button that opens the list. There is none while nothing is left to write down. */
  function control(count, onOpen) {
    if (!count) return null;
    var button = h('button', { class: 'paper-todo', type: 'button', 'data-testid': 'not-on-paper-open', onclick: onOpen });
    setCount(button, count);
    return button;
  }

  /** Shows the count on a button that exists. */
  function setCount(button, count) {
    button.textContent = L.copy.paper.open + ' ' + count;
    button.setAttribute('aria-label', L.copy.paper.openLabel(count));
    button.setAttribute('data-count', String(count));
  }

  L.paper.view = { shell: shell, content: content, subText: subText, rowMark: rowMark, control: control, setCount: setCount };
})();
