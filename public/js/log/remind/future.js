/*
 * The future-log nudge: a small sheet, shown on the first open of the log in a calendar month, asking the person to check the Future
 * log. "Open the future log" and "Not now" (and Escape, Back, the scrim) all record the month as done, so it shows once a month.
 * Never forced. Needs ak-dom.js, nav/overlays.js, copy.js and remind/store.js.
 * options: today(), onOpenFuture().
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.remind = L.remind || {};

  /** The sheet node: a title, one line of text and the two buttons. */
  function build(onOpen, onLater) {
    var words = L.copy.remind.future;
    var open = h('button', { class: 'ak-btn', type: 'button', 'data-testid': 'remind-future-open', onclick: onOpen }, words.open);
    var later = h('button', { class: 'ak-btn ak-btn-quiet', type: 'button', 'data-testid': 'remind-future-later', onclick: onLater }, words.later);
    return h('div', { class: 'ak-sheet sheet-entry sheet-migrate sheet-remind', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'remind-title', 'data-testid': 'remind-future' },
      h('div', { class: 'ak-sheet-head' }, h('div', { class: 'ak-grabber' }), h('h2', { class: 'sheet-title', id: 'remind-title' }, words.title), h('p', { class: 'sheet-sub' }, words.sub)),
      h('div', { class: 'ak-sheet-scroll' }, h('p', { class: 'remind-text' }, words.text)),
      h('div', { class: 'ak-sheet-dock' }, open, later));
  }

  /** Shows the nudge when this month has not been dismissed. Returns the kit's handle, or null when it did not show. */
  function maybeShow(options) {
    var today = options.today();
    if (!L.remind.store.futureDue(today)) return null;
    var sheet = null;
    var close = function () { if (sheet) sheet.close(); };
    var node = build(function () { close(); options.onOpenFuture(); }, close);
    sheet = BujoNav.overlays.showSheet(node, { onClose: function () { L.remind.store.dismissFuture(today); } });
    return sheet;
  }

  L.remind.future = { maybeShow: maybeShow };
})();
