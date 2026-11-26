/*
 * Page-gap copy: every string of the missing-page reminder and the quiet hint in the scan review, and the wording of page ranges.
 * Adds L.copy.gap to the log copy. Needs log/copy.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  /** One run as words: "12" for a single page, "12\u201314" (en dash) for a run. */
  function runText(run) {
    return run[0] === run[1] ? String(run[0]) : run[0] + '\u2013' + run[1];
  }

  /** Runs joined in plain English: "12\u201314, 16 and 18". */
  function joined(runs) {
    var parts = runs.map(runText);
    if (parts.length < 2) return parts.join('');
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /** The missing pages as words: "page 12", "pages 12\u201314", "pages 12\u201314, 16 and 18". */
  function pagesText(runs) {
    var one = runs.length === 1 && runs[0][0] === runs[0][1];
    return (one ? 'page ' : 'pages ') + joined(runs);
  }

  L.copy.gap = {
    pagesText: pagesText,
    /** The reminder after an apply: names the pages and says they are not scanned yet. */
    reminder: function (runs) {
      var one = runs.length === 1 && runs[0][0] === runs[0][1];
      return L.copy.gap.pagesText(runs).replace(/^./, function (first) { return first.toUpperCase(); }) + (one ? ' is' : ' are') + ' not scanned yet.';
    },
    /** The quiet line under the page number field of the review. */
    hint: function (runs) { return 'This leaves ' + pagesText(runs) + ' unscanned.'; },
    skip: 'Skip these pages',
    dismiss: 'Dismiss',
    dismissLabel: 'Dismiss the missing pages reminder',
    skipLabel: 'Skip these pages, they need no scan'
  };
})();
