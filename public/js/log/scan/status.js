/*
 * The sheet of a page that is not up for review: one that could not be read (with its message and a Try again button), or one that
 * was applied, saved or skipped already (a skipped one can be reviewed again). It keeps the page steps on top so the person can move on.
 * Needs ak-dom.js, ak-sheet.js, nav/overlays.js, copy.js and scan/copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** The message of the page: why it could not be read, or what became of it. A page skipped before it was read keeps its reason. */
  function messageOf(page) {
    return page.draft ? L.copy.scan.batch.text[page.status] : page.error;
  }

  /** The dock button, or null when the page needs none: Try again for a page that was never read (failed, or skipped as failed),
   * Review this page for a skipped page that was read. */
  function action(page, handlers, say) {
    var copy = L.copy.scan.batch;
    if (!page.draft && page.status !== 'applied') return retryButton(handlers.retry, say);
    if (page.status !== 'skipped') return null;
    return h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-action': 'review-again', onclick: handlers.again }, copy.reviewAgain);
  }

  /** The Try again button: reads the photo again while it shows "Reading", and puts a new failure message in the slot. */
  function retryButton(retry, say) {
    var copy = L.copy.scan.batch;
    var button = h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-action': 'retry' }, copy.retry);
    button.addEventListener('click', function () {
      if (button.disabled) return;
      button.disabled = true;
      button.textContent = copy.retrying;
      say('');
      retry().then(null, function (error) {
        button.disabled = false;
        button.textContent = copy.retry;
        say(error && error.message ? error.message : L.copy.scan.errors.scanFailed);
      });
    });
    return button;
  }

  /**
   * Opens the sheet of a page. steps is the page steps node (or null). handlers.retry() returns a promise (a failed page is read again),
   * handlers.again() puts a skipped page back to review, handlers.closed() runs when the sheet closes, however it closes.
   */
  function open(page, steps, handlers) {
    var copy = L.copy.scan.batch;
    var slot = h('div', { class: 'sheet-slot', 'aria-live': 'polite' });
    var button = action(page, handlers, function (message) { Bujo.say(slot, message); });
    var node = h('div', { class: 'ak-sheet sheet-entry sheet-scan sheet-page-status', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'scan-status-title', 'data-testid': 'scan-page-status', 'data-status': page.status },
      h('div', { class: 'ak-sheet-head' }, h('div', { class: 'ak-grabber' }), h('h2', { class: 'sheet-title', id: 'scan-status-title' }, L.copy.scan.review.title),
        h('p', { class: 'sheet-sub', 'data-testid': 'scan-status-sub' }, copy.statusSub(page.status))),
      h('div', { class: 'ak-sheet-scroll' }, slot, steps, h('p', { class: 'scan-status-text', 'data-testid': 'scan-status-text' }, messageOf(page))),
      button ? h('div', { class: 'ak-sheet-dock' }, button) : null);
    return BujoNav.overlays.showSheet(node, { onClose: handlers.closed });
  }

  L.scan.status = { open: open };
})();
