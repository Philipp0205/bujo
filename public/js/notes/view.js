/*
 * Notes render functions: the header, the two-column grid of ink cards and the quiet states. They build nodes and call back,
 * they never fetch. Needs ak-dom.js, notes/copy.js, log/api.js (photo address), log/glyph.js and log/paper/view.js (the page mark).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var B = window.BujoNotes = window.BujoNotes || {};
  var L = window.BujoLog;

  /** The page header: the italic title only. The tab bar does the navigation. */
  function header() {
    return h('div', { class: 'paper-head' }, h('h1', null, B.copy.title));
  }

  /** The stand-in for a note without a photo: a few dotted-paper lines, so the card keeps its shape. */
  function placeholder() {
    var node = h('span', { class: 'note-placeholder', 'data-testid': 'note-placeholder', role: 'img', 'aria-label': B.copy.noPhoto },
      L.glyph.use('g-scan-prose', { viewBox: '0 0 120 160', width: 48, height: 64 }));
    return node;
  }

  /** The photo of a note. A photo that fails to load is swapped for the placeholder. */
  function photo(card) {
    var img = h('img', { class: 'note-photo', 'data-testid': 'note-photo', src: L.api.photoUrl(card.id), alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', function () { img.replaceWith(placeholder()); });
    return img;
  }

  /** One card: the thumbnail (photo or placeholder) with a pen frame, and the title under it, with the page mark of a note not on paper. Opens the note sheet. */
  function card(item, onOpen) {
    return h('li', { class: 'note-item' },
      h('button', { class: 'note-card', type: 'button', 'data-id': item.id, 'aria-label': B.copy.openLabel + ': ' + item.title, onclick: function () { onOpen(item.id); } },
        h('span', { class: 'note-thumb' }, item.hasPhoto ? photo(item) : placeholder()),
        h('span', { class: 'note-foot' },
          h('span', { class: 'note-title' }, item.title),
          item.unwritten ? L.paper.view.rowMark() : null)));
  }

  /** The grid of one group. */
  function grid(cards, onOpen) {
    return h('ul', { class: 'note-grid', 'data-testid': 'note-grid' }, cards.map(function (item) { return card(item, onOpen); }));
  }

  /** All the groups. A group without a notebook has no heading. */
  function groupList(groups, onOpen) {
    return groups.map(function (group) { return grid(group.cards, onOpen); });
  }

  /** A quiet line for loading, for an empty list, for no connection and no cached list, and for a failed load with a retry button. */
  function stateNote(kind, onRetry) {
    var copy = B.copy;
    var texts = { error: copy.loadFailed, empty: copy.empty, offline: copy.offlineEmpty };
    var note = h('p', { class: 'paper-state', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, texts[kind] || copy.loading);
    if (kind !== 'error') return note;
    return h('div', null, note,
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: onRetry }, copy.retry));
  }

  /** The quiet line above the grid while the device is offline (the notes shown are the last ones read). */
  function offlineHint() {
    return h('p', { class: 'paper-hint', 'data-testid': 'offline-hint', role: 'status' }, B.copy.offlineHint);
  }

  B.view = { header: header, groupList: groupList, stateNote: stateNote, offlineHint: offlineHint };
})();
