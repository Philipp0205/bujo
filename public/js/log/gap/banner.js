/*
 * The missing-page reminder: after a rapid-log scan is applied with a paper number, a small paper banner above the tab bar names
 * the pages in between that were never scanned. "Dismiss" closes this showing only; "Skip these pages" keeps them skipped on
 * this device (gap/store.js). It never auto-hides and never blocks the log. Also gives the scan review its quiet hint.
 * Needs ak-dom.js, log/api.js, gap/model.js, gap/store.js and gap/copy.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.gap = L.gap || {};

  var node = null;

  /** Removes the banner on screen, if any. */
  function hide() {
    if (node) node.remove();
    node = null;
  }

  /** The banner node: the sentence, then the two quiet buttons. */
  function build(numbers) {
    var words = L.copy.gap;
    var runs = L.gap.model.ranges(numbers);
    var skip = h('button', { class: 'gap-btn', type: 'button', 'data-testid': 'gap-skip', 'aria-label': words.skipLabel, onclick: function () {
      L.gap.store.skip(numbers);
      hide();
    } }, words.skip);
    var dismiss = h('button', { class: 'gap-btn', type: 'button', 'data-testid': 'gap-dismiss', 'aria-label': words.dismissLabel, onclick: hide }, words.dismiss);
    return h('div', { class: 'gap-banner', role: 'status', 'data-testid': 'gap-reminder' },
      h('p', { class: 'gap-text', 'data-testid': 'gap-text' }, words.reminder(runs)),
      h('div', { class: 'gap-actions' }, skip, dismiss));
  }

  /** Puts the banner on screen in place of any earlier one. */
  function show(numbers) {
    hide();
    node = build(numbers);
    document.body.appendChild(node);
  }

  /** The numbers of the known pages (scans and collections) from the server's index; none when it cannot be read. */
  function knownNumbers() {
    return L.api.listIndex().then(function (pages) {
      return pages.map(function (page) { return page.number; });
    }, function () { return []; });
  }

  /** After an apply that stored `number`: shows the reminder when pages between the earlier ones and it were never scanned. */
  function after(number) {
    if (typeof number !== 'number') return Promise.resolve();
    return knownNumbers().then(function (known) {
      var numbers = L.gap.model.missing(known, number, L.gap.store.list());
      if (numbers.length) show(numbers);
    });
  }

  /** The pages a typed number would leave unscanned, given the known numbers (the review's quiet hint); [] for none. */
  function leaves(known, number) {
    return L.gap.model.missing(known, number, L.gap.store.list());
  }

  L.gap.banner = { after: after, hide: hide, known: knownNumbers, leaves: leaves };
})();
