/*
 * Render functions of the "not on paper" list: the sheet, a day with its rows, a row with its "Mark as written" button.
 * They build nodes and call back, they never fetch. Needs ak-dom.js, copy.js, dates.js, days.js, glyph.js and paper/model.js.
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

  /** One entry: its symbol, title and inked words, and the button that says it is written down now. */
  function row(entry, onWritten) {
    return h('div', { class: 'todo-row', 'data-id': entry.id, 'data-type': entry.type, 'data-testid': 'not-on-paper-row' },
      h('span', { class: 'paper-sym', role: 'img', 'aria-label': L.copy.typeLabels[entry.type] }, L.glyph.typeGlyph(entry.type)),
      h('span', { class: 'paper-body' },
        h('span', { class: 'paper-title' }, entry.title),
        pills(entry),
        h('button', { class: 'todo-written', type: 'button', 'data-action': 'mark-written', onclick: function () { onWritten(entry); } }, L.copy.paper.written)));
  }

  /** A day: its heading and its rows. */
  function day(group, onWritten) {
    return h('section', { class: 'todo-day', 'data-date': group.date },
      h('h3', { class: 'todo-day-head', 'data-testid': 'not-on-paper-day' }, L.dates.dayHeading(group.date)),
      group.entries.map(function (entry) { return row(entry, onWritten); }));
  }

  /** A quiet line: the loading note, the failure, or "Everything is on paper." */
  function note(text, kind) {
    return h('p', { class: 'todo-note', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, text);
  }

  /** What the scroll area shows for a status: the days with their rows, or a note. */
  function content(state, onWritten) {
    if (state.status === 'loading') return note(L.copy.loading, 'loading');
    if (state.status === 'error') return note(L.copy.paper.failed, 'error');
    if (!state.entries.length) return note(L.copy.paper.empty, 'empty');
    return L.paper.model.groups(state.entries).map(function (group) { return day(group, onWritten); });
  }

  /** The line under the sheet title: how many entries are left to write down. */
  function subText(state) {
    return state.status === 'ready' && state.entries.length ? L.copy.paper.sub(state.entries.length) : L.copy.paper.subEmpty;
  }

  /** The sheet node with the parts the controller redraws: the sub line, the scroll slot and the Copy all button. */
  function shell(onCopyAll) {
    var parts = {
      sub: h('p', { class: 'sheet-sub', 'data-testid': 'not-on-paper-sub' }),
      slot: h('div', { class: 'todo-list', 'data-testid': 'not-on-paper-list' }),
      copy: h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-testid': 'copy-all', onclick: onCopyAll }, L.copy.paper.copyAll)
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
      h('div', { class: 'ak-sheet-dock' }, parts.copy));
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
