/*
 * Keeps the place in a long page across a redraw. The log draws its whole page again after every change, which would drop the inner
 * scroller back to the top, so the scroll offset is read before the redraw and put back after it (not after a page turn, which starts at the top).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  /** The scroll offset and the day of the page on screen, read before it is replaced. Null when there is no page body yet. */
  function capture(root) {
    var body = root.querySelector('.page-body');
    return body ? { date: body.getAttribute('data-date'), top: body.scrollTop } : null;
  }

  /** Puts the offset back on the new page body when it shows the same day and no turn happened. */
  function restore(root, seen, turned) {
    var body = root.querySelector('.page-body');
    if (!seen || !body || turned || body.getAttribute('data-date') !== seen.date) return;
    body.scrollTop = seen.top;
  }

  L.pages.scroll = { capture: capture, restore: restore };
})();
