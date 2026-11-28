/*
 * Puts the small imperfections on the handwritten bits: sets --jit-rot and --jit-y on each entry row (and on a page number) from the hash of
 * its id (feel/jitter-model.js). The CSS in paper-details.css reads them. A watcher marks rows as the app draws them, so no render code calls it.
 * Needs feel/jitter-model.js and the DOM.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.feel = L.feel || {};

  /** The nodes that carry handwriting and have not been marked yet. */
  var PENDING = '.paper-row[data-id]:not([data-jit]), .todo-row[data-id]:not([data-jit]), .scan-row[data-id]:not([data-jit]), .page-number:not([data-jit])';

  /** What a node is keyed by: its entry id, else its date, else its text (a page number). */
  function keyOf(node) {
    return node.getAttribute('data-id') || node.getAttribute('data-date') || node.textContent || '';
  }

  /** Marks one node with its tilt and lift. */
  function mark(node) {
    var jitter = L.feel.jitterModel.jitter(keyOf(node));
    node.style.setProperty('--jit-rot', jitter.rot + 'deg');
    node.style.setProperty('--jit-y', jitter.y + 'px');
    node.setAttribute('data-jit', '');
  }

  /** Marks every unmarked handwriting node under a root. */
  function scan(root) {
    Array.prototype.forEach.call(root.querySelectorAll(PENDING), mark);
  }

  /** Starts marking: what is on the page now, then whatever the app draws later. Call once. */
  function init() {
    scan(document);
    new MutationObserver(function () { scan(document); }).observe(document.body, { childList: true, subtree: true });
  }

  L.feel.jitter = { scan: scan, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
