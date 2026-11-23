/*
 * Keeps the place in a long page across a redraw. The log draws its whole page again after every change. The sheet (#log) is the scroller,
 * so its scroll offset is read before the redraw and put back after it (not after a page turn or a view switch, which start at the top).
 * While the select bar is pinned to the top of the screen it also keeps the bar's dots in step with the sheet's, so no seam shows under it.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.pages = L.pages || {};

  /** The scroll offset and the day of the page on screen, read before it is replaced. Null when there is no page body yet. */
  function capture(root) {
    var body = root.querySelector('.page-body');
    return body ? { date: body.getAttribute('data-date'), top: root.scrollTop } : null;
  }

  /** Puts the offset back on the sheet when the new page shows the same day and no turn happened; any other page starts at the top. */
  function restore(root, seen, turned) {
    var body = root.querySelector('.page-body');
    var same = !!seen && !!body && !turned && body.getAttribute('data-date') === seen.date;
    root.scrollTop = same ? seen.top : 0;
    sync(root);
  }

  /** Tells the pinned select bar how far the sheet has scrolled, so its own dots land where the sheet's do (see log.css). */
  function sync(root) {
    var bar = root.querySelector('.select-bar');
    if (bar) bar.style.setProperty('--sheet-scroll', root.scrollTop + 'px');
  }

  /** Starts following the scroll of the sheet. Call once. */
  function init(root) {
    root.addEventListener('scroll', function () { sync(root); }, { passive: true });
  }

  L.pages.scroll = { capture: capture, restore: restore, init: init };
})();
