/*
 * The page-type switch of the scan: Log page or Note or collection. It sits on top of both the log review and the note sheet, so the person
 * can change their mind without a second scan. A view only: the flow (flow.js) decides what each choice shows.
 * Needs ak-dom.js, copy.js and scan/copy.js. Its look is the kind switch's (log-scan.css).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var TYPES = ['log', 'note'];

  /** Where the type came from: the guess while it is still the guessed one, else the person. */
  function sourceOf(page) {
    return page.type === page.guess.type ? page.guess.source : 'picked';
  }

  /** The switch for a page ({ type, guess: { type, source } }). onPick(type) runs when the other type is tapped. */
  function row(page, onPick) {
    var copy = L.copy.scan.review;
    var buttons = TYPES.map(function (type) {
      return h('button', {
        class: 'scan-kind', type: 'button', 'data-type': type, 'aria-pressed': type === page.type ? 'true' : 'false',
        onclick: function () { if (type !== page.type) onPick(type); }
      }, copy.types[type]);
    });
    var note = h('p', { class: 'scan-kind-note', 'data-testid': 'scan-type-source' }, copy.typeSource[sourceOf(page)]);
    return h('div', { class: 'scan-kinds scan-pagetype', 'data-testid': 'scan-type' },
      h('div', { class: 'scan-kind-pills', role: 'group', 'aria-label': copy.typeGroup }, buttons), note);
  }

  L.scan.type = { row: row };
})();
