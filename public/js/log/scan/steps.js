/*
 * The page steps of a multi-page scan: "Page x of N" with previous and next, one dot per page showing its state, and a Skip action.
 * It sits on top of the review sheet, the note sheet and the status sheet. A view only: scan/session.js decides what each tap does.
 * Needs ak-dom.js, copy.js and scan/copy.js. Its look is in log-scan.css.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** A small round-cornered button with a text label. */
  function stepButton(label, text, action, onclick) {
    return h('button', { class: 'scan-step', type: 'button', 'aria-label': label, 'data-action': action, onclick: onclick }, text);
  }

  /** One dot per page: its state is the colour (data-status) and the spoken name. The current page is marked. */
  function dots(pages, index, go) {
    var copy = L.copy.scan.batch;
    return h('div', { class: 'scan-dots', role: 'group', 'aria-label': copy.group, 'data-testid': 'scan-dots' }, pages.map(function (page, at) {
      return h('button', {
        class: 'scan-dot', type: 'button', 'data-status': page.status, 'aria-current': at === index ? 'true' : 'false',
        'aria-label': copy.dot(at + 1, copy.status[page.status]), onclick: function () { go(at); }
      });
    }));
  }

  /** The Skip action: only for a page still open (to review or not read). */
  function skipButton(page, onSkip) {
    if (page.status !== 'pending' && page.status !== 'failed') return null;
    return h('button', { class: 'scan-skip', type: 'button', 'data-action': 'skip-page', onclick: onSkip }, L.copy.scan.batch.skip);
  }

  /**
   * The steps node for pages[index], or null for a single page (it has no steps). handlers.go(i) shows page i, handlers.skip() skips this page.
   */
  function row(pages, index, handlers) {
    if (pages.length < 2) return null;
    var copy = L.copy.scan.batch;
    var heading = h('span', { class: 'scan-steps-title', 'data-testid': 'scan-page-of', role: 'status' }, copy.heading(index + 1, pages.length));
    var prev = stepButton(copy.prev, '\u2039', 'prev-page', function () { handlers.go(index - 1); });
    var next = stepButton(copy.next, '\u203a', 'next-page', function () { handlers.go(index + 1); });
    prev.disabled = index === 0;
    next.disabled = index === pages.length - 1;
    return h('div', { class: 'scan-steps', 'data-testid': 'scan-steps' },
      h('div', { class: 'scan-steps-head' }, prev, heading, next),
      dots(pages, index, handlers.go),
      skipButton(pages[index], handlers.skip));
  }

  L.scan.steps = { row: row };
})();
