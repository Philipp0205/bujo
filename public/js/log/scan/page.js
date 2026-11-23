/*
 * The page row of the scan review: which physical page of a long day the photo shows. It only appears when the day already has
 * paper from an earlier scan. A page that exists is a rescan, the next number is a new page that follows the others.
 * A view only: the rules live in scan/model.js. Needs ak-dom.js, copy.js, scan/copy.js and scan/model.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** One pill per page choice, marked on the state's page. */
  function pills(state, onPick) {
    var copy = L.copy.scan.review;
    return L.scan.model.pageOptions(state).map(function (option) {
      return h('button', {
        class: 'scan-kind', type: 'button', 'data-page': String(option.page), 'aria-pressed': option.page === state.page ? 'true' : 'false',
        onclick: function () { if (option.page !== state.page) { L.scan.model.setPage(state, option.page); onPick(); } }
      }, copy.page(option.page));
    });
  }

  /** The words under the pills: a rescan of an existing page, or a new page that follows. */
  function noteText(state) {
    var copy = L.copy.scan.review;
    return state.pages.indexOf(state.page) >= 0 ? copy.pageRescan(state.page) : copy.pageNew(state.page);
  }

  /** The page row: a group of pills (hidden while the day has no paper yet) and a note. onPick() runs after another page is chosen. */
  function pageRow(state, onPick) {
    var note = h('p', { class: 'scan-kind-note', 'data-testid': 'scan-page-note' });
    var group = h('div', { class: 'scan-kind-pills', role: 'group', 'aria-label': L.copy.scan.review.pageGroup, 'data-testid': 'scan-pages' });
    var node = h('div', { class: 'scan-kinds', 'data-testid': 'scan-page-row' }, group, note);
    return {
      node: node,
      refresh: function () {
        node.hidden = state.kind !== 'daily' || state.pages.length === 0;
        group.replaceChildren.apply(group, pills(state, onPick));
        note.textContent = node.hidden ? '' : noteText(state);
      }
    };
  }

  L.scan.page = { row: pageRow };
})();
