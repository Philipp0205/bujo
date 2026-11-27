/*
 * The Notes tab host: the screen of the physical notebooks (public/js/notebooks) is drawn into the page's main element, and this
 * file does what only the host can: it registers the page with BujoNav.router, opens a collection page or the page list of a notebook
 * in place of the screen, and sends a tapped log page to the log. The router shows the page on a cold load of /notes and again whenever
 * the Notes tab is tapped (the page stays in the document, hidden, while another tab is on screen); that also leaves an open collection
 * page or page list for the notebooks list. Needs the notebooks files, the notes files, the collections files, the index files, the log
 * api, ink and note sheet files, the log row files (for a collection page) and the nav files.
 */
(function () {
  'use strict';

  var L = window.BujoLog;
  var root = document.getElementById('notes');

  /** True while a collection page or the page list is drawn into the root: the notebooks screen then leaves the root alone. */
  function suspended() {
    return L.collections.page.isOpen() || BujoIndex.screen.isOpen();
  }

  /** Opens the page of a collection in place of the screen. The way back reads the notebook again, so counts are current. */
  function openCollection(collection) {
    L.collections.page.open(root, collection, leaveCollection);
  }

  /** Back from a collection page to its notebook. */
  function leaveCollection() {
    L.collections.page.close();
    BujoNotebooks.screen.refreshDetail();
  }

  /** Opens the page list of one notebook (the earlier "notebook index") in place of the screen. The way back shows the notebook again. */
  function openIndex(detail) {
    var read = function () { return L.api.getNotebook(detail.notebook.id).then(function (fresh) { return fresh.pages; }); };
    BujoIndex.screen.open(root, { onBack: leaveIndex, onOpen: openPage, read: read });
    window.scrollTo(0, 0);
  }

  /** Back from the page list to the notebook. */
  function leaveIndex() {
    BujoIndex.screen.close();
    BujoNotebooks.screen.draw();
  }

  /** The phone's Back on a collection page or page list: closes it and shows its notebook again. */
  function leaveSub() {
    if (BujoIndex.screen.isOpen()) leaveIndex();
    else leaveCollection();
  }

  /** A tapped page: a collection opens its page here, any other page opens in the log (a day, the month log or the future log). */
  function openPage(item) {
    var target = BujoIndex.model.targetOf(item);
    if (!target.collection) return BujoNav.router.go('log', { open: target });
    BujoIndex.screen.close();
    openCollection({ id: item.ref, name: item.label || '', count: 0, paperPage: item.number });
  }

  /** The router shows Notes: leaves an open collection page or page list, then shows the notebooks list. */
  function show() {
    L.collections.page.close();
    BujoIndex.screen.close();
    return BujoNotebooks.screen.show();
  }

  BujoNotebooks.screen.init(root, { onOpenCollection: openCollection, onOpenPage: openPage, onOpenIndex: openIndex, leaveSub: leaveSub, suspended: suspended });
  BujoNav.router.start('notes', { show: show, warm: BujoNotebooks.screen.warm, leave: BujoNotebooks.screen.leave, reselect: show });
})();
