/*
 * The what's-new sheet: dated entries with a title and bullets, in an AppKit.sheet. Text only, built with textContent
 * (AppKit.h text nodes), never innerHTML. options.paper picks the paper look of the log, else the plain look of settings.
 * Needs ak-dom.js, ak-sheet.js, ak-whats-new.js, nav/overlays.js and copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};

  /** One entry: its day, its title and its bullets. */
  function entryNode(entry) {
    return h('article', { class: 'wn-entry', 'data-entry-id': entry.id },
      h('p', { class: 'wn-date' }, AppKit.whatsNew.formatEntryDate(entry.date)),
      h('h3', { class: 'wn-title' }, entry.title),
      h('ul', { class: 'wn-bullets' }, entry.bullets.map(function (bullet) { return h('li', null, bullet); })));
  }

  /** The head: grabber, heading and a line under it that says which entries these are. */
  function head(options) {
    var copy = W.copy;
    return h('div', { class: 'ak-sheet-head' },
      h('div', { class: 'ak-grabber' }),
      h('h2', { class: options.paper ? 'sheet-title' : 'wn-heading', id: 'wn-heading' }, copy.heading),
      h('p', { class: options.paper ? 'sheet-sub' : 'wn-sub', 'data-testid': 'whats-new-sub' },
        options.mode === 'all' ? copy.subAll : copy.subUnseen));
  }

  /** The sheet node. The Done button closes it, so the same onClose runs as for a swipe or a tap on the scrim. */
  function build(options, close) {
    var done = h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-action': 'whats-new-done', onclick: close }, W.copy.done);
    return h('div', {
      class: 'ak-sheet wn-sheet' + (options.paper ? ' sheet-entry sheet-scan' : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wn-heading', 'data-testid': 'whats-new-sheet', 'data-mode': options.mode
    },
      head(options),
      h('div', { class: 'ak-sheet-scroll' }, h('div', { class: 'wn-list' }, options.entries.map(entryNode))),
      h('div', { class: 'ak-sheet-dock' }, done));
  }

  /**
   * Opens the sheet. options: entries (the ones to show), mode ('unseen' or 'all'), paper (true on the log),
   * onClose (runs once when it starts closing). Returns the sheet handle, or null when another sheet is open.
   */
  function open(options) {
    var sheet = null;
    var node = build(options, function () { if (sheet) sheet.close(); });
    sheet = BujoNav.overlays.showSheet(node, { onClose: options.onClose });
    return sheet;
  }

  W.sheet = { open: open };
})();
