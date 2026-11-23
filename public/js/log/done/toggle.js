/*
 * The one-tap done toggle of the daily log: the bullet of a task turns it done, and again turns it
 * back into a task. The row flips at once, then the change goes through the outbox (a PATCH of { type }), which queues it when
 * the device is offline. A refusal puts the row back and says so. Select mode is left alone. Event, note, moved and scheduled
 * entries never toggle.
 * Needs done/model.js, done/flip.js, outbox/save.js, paper/recent.js, toast.js and copy.js.
 * Every page that shows rows (the log, a collection page) wires its own host: entries() the entries on screen, today(),
 * upsert(entry) to take the saved entry, paint() redraws the page. A toggle goes to the host that holds the entry.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.done = L.done || {};

  var INK_MS = 260;
  var hosts = [];
  var busy = {};

  /** The wired page that has this entry on screen, with the entry: { host, selecting, entry }, or null. */
  function ownerOf(id) {
    for (var i = 0; i < hosts.length; i += 1) {
      var entry = hosts[i].host.entries().filter(function (item) { return item.id === id; })[0];
      if (entry) return { host: hosts[i].host, selecting: hosts[i].selecting, entry: entry };
    }
    return null;
  }

  /** Whether the row of this entry carries the "not on paper" mark when it has this type. */
  function marked(host, entry, type) {
    return L.paper.recent.shows(Object.assign({}, entry, { type: type }), host.today());
  }

  /** The save went through (or was queued): the state takes the entry, and the page is drawn again once the ink has settled. */
  function saved(host, id, entry) {
    delete busy[id];
    host.upsert(entry);
    window.setTimeout(host.paint, INK_MS);
  }

  /** The server refused the change: the row goes back to what it was, with a short line saying so. */
  function refused(host, entry) {
    delete busy[entry.id];
    L.done.flip.apply(L.done.flip.rowOf(entry.id), entry.type, marked(host, entry, entry.type));
    L.toast.show(L.copy.errors.actionFailed, 'fail');
  }

  /** Flips one entry between task and done: the row at once, then the save. One flip per entry at a time. */
  function toggle(id) {
    var owner = ownerOf(id);
    var type = owner && L.done.model.next(owner.entry.type);
    if (!type || busy[id] || owner.selecting()) return;
    busy[id] = true;
    L.done.flip.apply(L.done.flip.rowOf(id), type, marked(owner.host, owner.entry, type));
    L.done.flip.buzz();
    L.outbox.save.update(owner.entry, { type: type }).then(function (next) { saved(owner.host, id, next); }, function () { refused(owner.host, owner.entry); });
  }

  /** Wires the toggle to a page's host. select is select mode (its on() says whether it is on). */
  function init(options) {
    hosts.push({ host: options.host, selecting: options.select.on });
  }

  L.done.toggle = { init: init, toggle: toggle };
})();
