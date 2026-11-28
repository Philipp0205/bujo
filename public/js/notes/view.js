/*
 * Notes render functions: the two ways to start (a note, a collection), the way into the page list of a notebook, the collection rows, the two-column grid of ink cards and the quiet states. They build nodes and call back,
 * they never fetch. Needs ak-dom.js, notes/copy.js, collections/copy.js, index/copy.js, log/api.js (photo address), log/glyph.js and log/paper/view.js (the page mark).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var B = window.BujoNotes = window.BujoNotes || {};
  var L = window.BujoLog;

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

  /** The two ways to start something on this screen: a note written by hand, and a new collection. */
  function actions(onNote, onCollection) {
    var copy = L.collections.copy;
    return h('div', { class: 'notes-actions' },
      h('button', { class: 'paper-link tab-button', type: 'button', 'data-action': 'new-note', 'data-testid': 'new-note', onclick: onNote }, copy.newNote),
      h('button', { class: 'paper-link tab-button', type: 'button', 'data-action': 'new-collection', 'data-testid': 'new-collection', onclick: onCollection }, copy.newCollection));
  }

  /** The way into the page list of the notebook: a quiet row with the count of listed pages (left out when the count is not known). */
  function indexEntry(count, onOpen) {
    var copy = window.BujoIndex.copy;
    return h('div', { class: 'notes-index-entry' },
      h('button', {
        class: 'collection-row', type: 'button', 'data-action': 'open-page-list', 'data-testid': 'open-page-list',
        'aria-label': count === null ? copy.entry : copy.entryLabel(count), onclick: onOpen
      }, h('span', { class: 'collection-row-name' }, copy.entry),
        count === null ? null : h('span', { class: 'collection-row-meta' }, h('span', { class: 'collection-row-count', 'data-testid': 'index-count' }, copy.entryCount(count)))));
  }

  /** A small italic heading over a section of the index. */
  function heading(text) {
    return h('h2', { class: 'notes-heading' }, text);
  }

  /** One collection as a row: the name, and how many entries it holds. A tap opens its page. */
  function collectionRow(collection, onOpen) {
    var copy = L.collections.copy;
    var page = L.collections.model.pageOf(collection);
    return h('li', { class: 'collection-item' },
      h('button', {
        class: 'collection-row', type: 'button', 'data-testid': 'collection-row', 'data-id': collection.id,
        'aria-label': copy.openLabel + ': ' + collection.name, onclick: function () { onOpen(collection); }
      }, h('span', { class: 'collection-row-name' }, collection.name),
        h('span', { class: 'collection-row-meta' },
          h('span', { class: 'collection-row-count' }, copy.count(collection.count)),
          page === null ? null : h('span', { class: 'collection-row-page', 'data-testid': 'collection-row-page' }, copy.pageMark(page)))));
  }

  /** The Collections section of the index: its heading and one row per collection. Null when there are none. */
  function collectionList(collections, onOpen) {
    if (!collections.length) return null;
    return h('section', { class: 'notes-section', 'data-testid': 'collection-index' },
      heading(L.collections.copy.indexHeading),
      h('ul', { class: 'collection-list' }, collections.map(function (collection) { return collectionRow(collection, onOpen); })));
  }

  /** The Notes section of the index: the grid, under a heading when collections are listed above it. Null when there are no notes. */
  function noteSection(groups, onOpen, titled) {
    if (!groups.length) return null;
    return h('section', { class: 'notes-section' }, titled ? heading(L.collections.copy.notesHeading) : null, groupList(groups, onOpen));
  }

  /** A quiet line for loading, for an empty list, for no connection and no cached list, and for a failed load with a retry button. */
  function stateNote(kind, onRetry) {
    var copy = B.copy;
    var texts = { error: copy.loadFailed, offline: copy.offlineEmpty };
    var note = h('p', { class: 'paper-state', 'data-state': kind, role: kind === 'error' ? 'alert' : 'status' }, texts[kind] || copy.loading);
    if (kind !== 'error') return note;
    return h('div', null, note,
      h('button', { class: 'paper-link', type: 'button', 'data-action': 'retry', onclick: onRetry }, copy.retry));
  }

  /** The quiet line above the grid while the device is offline (the notes shown are the last ones read). */
  function offlineHint() {
    return h('p', { class: 'paper-hint', 'data-testid': 'offline-hint', role: 'status' }, B.copy.offlineHint);
  }

  B.view = { noteSection: noteSection, collectionList: collectionList, actions: actions, indexEntry: indexEntry, stateNote: stateNote, offlineHint: offlineHint };
})();
