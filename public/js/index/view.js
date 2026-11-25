/*
 * Notebook index render functions: the header with its way back, one row per page (a big "p. 12" on the left, the label after it)
 * and the quiet states. They build nodes and call back, they never fetch. Needs ak-dom.js and index/copy.js, index/model.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var I = window.BujoIndex = window.BujoIndex || {};

  /** The page header: the title, and the way back to the Notes list. */
  function header(onBack) {
    return h('div', { class: 'paper-head' },
      h('h1', { 'data-testid': 'index-title' }, I.copy.title),
      h('button', { class: 'paper-link index-back', type: 'button', 'data-action': 'index-back', 'aria-label': I.copy.backLabel, onclick: onBack }, I.copy.back));
  }

  /** One page as a row: its number big on the left, its label after it. A tap opens that page. */
  function row(item, onOpen) {
    var mark = I.copy.pageMark(item.number);
    var label = I.model.labelOf(item);
    return h('li', { class: 'index-item' },
      h('button', {
        class: 'index-row', type: 'button', 'data-testid': 'index-row', 'data-kind': item.kind, 'data-ref': item.ref, 'data-page': String(item.page),
        'aria-label': I.copy.openLabel(mark, label), onclick: function () { onOpen(item); }
      }, h('span', { class: 'index-number', 'data-testid': 'index-number' }, mark), h('span', { class: 'index-label', 'data-testid': 'index-label' }, label)));
  }

  /** The list of pages, in the order the server gave (ascending by number). */
  function list(pages, onOpen) {
    return h('ul', { class: 'index-list', 'data-testid': 'index-list' }, pages.map(function (item) { return row(item, onOpen); }));
  }

  /** A quiet line for loading, for an empty index, for no connection, and for a failed load with a retry button. */
  function stateNote(kind, onRetry) {
    var copy = I.copy;
    var texts = { error: copy.loadFailed, empty: copy.empty, offline: copy.offline };
    var note = h('p', { class: 'paper-state', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, texts[kind] || copy.loading);
    if (kind !== 'error') return note;
    return h('div', null, note, h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: onRetry }, copy.retry));
  }

  I.view = { header: header, list: list, stateNote: stateNote };
})();
