/*
 * The move of a closed row: what a row swipe does once it commits. It opens the move chooser on the log (a paper overlay), and a pick goes
 * on the entry the way a pick in the editor does: the model puts the place on a line, the change is saved through the outbox, and a real
 * move leaves its trace. Closing the chooser with no pick changes nothing. No fetch of its own.
 * Needs inline/model.js, move/model.js, move/chooser.js, outbox/save.js, toast.js and copy.js.
 * host: entries() the entries on screen, today(), upsert(entry, kind) to take the saved entry.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.move = L.move || {};

  var host = null;

  /** The entry with this id among the ones on screen. */
  function entryOf(id) {
    return host.entries().filter(function (entry) { return entry.id === id; })[0] || null;
  }

  /** The pick is saved: the page takes the entry (and the trace a move left). A refusal says so and leaves the page as it was. */
  function save(entry, body) {
    L.outbox.save.update(entry, body).then(function (next) {
      host.upsert(next, body.trace);
    }, function () {
      L.toast.show(L.copy.errors.actionFailed, 'fail');
    });
  }

  /** A place was picked: it goes on a line of the entry, and what changed is sent. */
  function pick(entry, kind, target) {
    L.move.chooser.close();
    var line = L.inline.model.fromEntry(entry);
    L.move.model.apply(line, kind, target);
    var body = L.inline.model.changes(line);
    if (Object.keys(body).length) save(entry, body);
  }

  /** Opens the chooser for the entry of a swiped row, in the kind the swipe asked for. */
  function open(id, kind) {
    var entry = entryOf(id);
    if (!entry || entry.type !== 'task') return;
    var line = L.inline.model.fromEntry(entry);
    L.move.chooser.open({
      kind: kind, overlay: true, choices: L.move.model.options(line, kind, host.today()), selected: null, today: host.today(),
      onPick: function (target) { pick(entry, kind, target); }
    });
  }

  /** Wires the move to its host and starts watching row swipes on the page. select is select mode (its on() says whether it is on). */
  function init(options) {
    host = options.host;
    L.move.swipe.init({ root: options.root, active: function () { return !options.select.on(); }, onSwipe: open });
  }

  L.move.pick = { init: init };
})();
