/*
 * The notebook the page-gap reminder looks at: the ACTIVE notebook only. Its known page numbers come from the notebook's own detail
 * (scans and collections of that notebook), so the pages of an ended notebook are never counted. It also says whether that notebook
 * is the first one (the oldest), whose skips include the old single key (gap/store.js). Needs log/api.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.gap = L.gap || {};

  /** { id, first } of the active notebook in a list from GET /api/notebooks; null when none is active. first: it is the oldest one. */
  function pick(notebooks) {
    var active = notebooks.filter(function (notebook) { return notebook.active; })[0];
    if (!active) return null;
    var oldest = notebooks.reduce(function (best, notebook) { return notebook.createdAt < best.createdAt ? notebook : best; }, notebooks[0]);
    return { id: active.id, first: active.id === oldest.id };
  }

  /** Reads the active notebook: { id, first, numbers } (the numbers of its known pages), or null when it cannot be read. */
  function load() {
    return L.api.listNotebooks().then(function (notebooks) {
      var scope = pick(notebooks);
      if (!scope) return null;
      return L.api.getNotebook(scope.id).then(function (detail) {
        return { id: scope.id, first: scope.first, numbers: detail.pages.map(function (page) { return page.number; }) };
      });
    }).then(null, function () { return null; });
  }

  L.gap.scope = { pick: pick, load: load };
})();
