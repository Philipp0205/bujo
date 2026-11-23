/*
 * The one-tap done toggle of the daily log: the bullet of a task turns it done, and again turns it
 * back into a task. The row flips at once, then the change goes through the outbox (a PATCH of { type }), which queues it when
 * the device is offline. A refusal puts the row back and says so. Select mode is left alone. Event, note, moved and scheduled
 * entries never toggle.
 * Needs done/model.js, done/flip.js, outbox/save.js, paper/recent.js, toast.js and copy.js.
 * host: entries() the entries on screen, today(), upsert(entry) to take the saved entry, paint() redraws the page.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.done = L.done || {};

  var INK_MS = 260;
  var host = null;
  var selecting = null;
  var busy = {};

  /** The entry with this id among the ones on screen. */
  function entryOf(id) {
    return host.entries().filter(function (entry) { return entry.id === id; })[0] || null;
  }

  /** Whether the row of this entry carries the "not on paper" mark when it has this type. */
  function marked(entry, type) {
    return L.paper.recent.shows(Object.assign({}, entry, { type: type }), host.today());
  }

  /** The save went through (or was queued): the state takes the entry, and the page is drawn again once the ink has settled. */
  function saved(id, entry) {
    delete busy[id];
    host.upsert(entry);
    window.setTimeout(host.paint, INK_MS);
  }

  /** The server refused the change: the row goes back to what it was, with a short line saying so. */
  function refused(entry) {
    delete busy[entry.id];
    L.done.flip.apply(L.done.flip.rowOf(entry.id), entry.type, marked(entry, entry.type));
    L.toast.show(L.copy.errors.actionFailed, 'fail');
  }

  /** Flips one entry between task and done: the row at once, then the save. One flip per entry at a time. */
  function toggle(id) {
    var entry = entryOf(id);
    var type = entry && L.done.model.next(entry.type);
    if (!type || busy[id] || selecting()) return;
    busy[id] = true;
    L.done.flip.apply(L.done.flip.rowOf(id), type, marked(entry, type));
    L.done.flip.buzz();
    L.outbox.save.update(entry, { type: type }).then(function (next) { saved(id, next); }, function () { refused(entry); });
  }

  /** Wires the toggle to its host. select is select mode (its on() says whether it is on). */
  function init(options) {
    host = options.host;
    selecting = options.select.on;
  }

  L.done.toggle = { init: init, toggle: toggle };
})();
