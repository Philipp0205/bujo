/*
 * The count behind the "Not on paper" header button: how many entries of the last two weeks, the coming days and the coming months are not on paper.
 * It reads the server's own list (never Nextcloud), keeps the number, and updates the button in place, so the log needs no redraw.
 * Needs api.js, paper/recent.js, paper/model.js and paper/view.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.paper = L.paper || {};

  var total = 0;
  var latest = 0;
  var root = null;
  var onOpen = null;

  /** The header on screen, if any (the select bar replaces it while selecting, and then there is nothing to patch). */
  function head() {
    return root ? root.querySelector('.paper-head') : null;
  }

  /** Puts the number on the header: adds the button at the first entry, updates it, removes it at zero. */
  function show(count) {
    var bar = head();
    if (!bar) return;
    var node = bar.querySelector('[data-testid="not-on-paper-open"]');
    if (node && count) L.paper.view.setCount(node, count);
    else if (node) node.remove();
    else if (count) bar.appendChild(L.paper.view.control(count, onOpen));
  }

  /** Keeps a number and shows it on the header. */
  function set(count) {
    total = count;
    show(count);
  }

  /** Reads the number again. Only the newest read counts, so a slow answer never overwrites a newer one. A failed read keeps the old number. */
  function refresh(today) {
    var mine = ++latest;
    var range = L.paper.model.range(today);
    return L.api.listNotOnPaper(range.from, range.to).then(function (entries) {
      if (mine === latest) set(entries.length);
    }, function () {});
  }

  /** Tells the module where the header lives and what the button does. */
  function init(page, open) {
    root = page;
    onOpen = open;
  }

  L.paper.count = { init: init, get: function () { return total; }, set: set, refresh: refresh };
})();
