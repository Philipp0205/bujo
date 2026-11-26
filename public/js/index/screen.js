/*
 * The notebook index screen: every known notebook page, ascending by number, opened in place of the Notes list (the same open and
 * back pattern as the collection page). It reads GET /api/index each time it opens (or the pages handlers.read gives, for one notebook), keeps its own state, and hands a tapped row to
 * the host (handlers.onOpen), which knows how to show a day, a month log, the future log or a collection. A failed read shows the
 * quiet error or offline note. Needs ak-dom.js, index/*, log/api.js and log/outbox/model.js (the offline check).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var I = window.BujoIndex = window.BujoIndex || {};
  var L = window.BujoLog;

  var state = { open: false, status: 'loading', pages: [] };
  var root = null;
  var handlers = null;

  /** The loading, error and offline notes, an empty note, or the list. */
  function body() {
    if (state.status !== 'ready') return I.view.stateNote(state.status, load);
    if (!state.pages.length) return I.view.stateNote('empty');
    return I.view.list(state.pages, handlers.onOpen);
  }

  /** Draws the whole screen from the state. The page is small, so nothing is patched in place. */
  function draw() {
    if (!state.open) return;
    root.replaceChildren(I.view.header(handlers.onBack), h('div', { class: 'paper-page index-page' }, body()));
  }

  /** Reads the index from the server and draws it. A read that fails for lack of a connection says so quietly. */
  function load() {
    state.status = 'loading';
    draw();
    return (handlers.read || L.api.listIndex)().then(function (pages) {
      state.pages = pages;
      state.status = 'ready';
      draw();
    }, function (error) {
      state.status = L.outbox.model.isNetworkMiss(error, navigator.onLine) ? 'offline' : 'error';
      draw();
    });
  }

  /** Opens the index into the root. handlers: onBack(), onOpen(item), and read() (a promise of the pages; the user's whole index when left out). */
  function open(into, given) {
    root = into;
    handlers = given;
    state = { open: true, status: 'loading', pages: [] };
    return load();
  }

  /** Leaves the screen: nothing of it is drawn any more. */
  function close() {
    state.open = false;
  }

  function isOpen() {
    return state.open;
  }

  I.screen = { open: open, close: close, isOpen: isOpen };
})();
