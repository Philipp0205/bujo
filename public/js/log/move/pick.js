/*
 * The move of a closed row: what a row swipe does once it commits. It opens the move chooser on the log (a paper overlay), and a pick goes
 * on the entry the way a pick in the editor does: the model puts the place on a line, the change is saved through the outbox, and a real
 * move leaves its trace. Closing the chooser with no pick changes nothing. No fetch of its own.
 * Needs inline/model.js, move/model.js, move/chooser.js, outbox/save.js, toast.js and copy.js.
 * host: entries() the entries on screen, today(), upsert(entry, kind) to take the saved entry, paint() to redraw the page after it.
 * The migration review (migrate/sheet.js) uses move(), choose() and drop() too, so a kept or scheduled task takes the same path as a swipe.
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

  /** The change is saved: the page takes the entry (and the trace a move left). Resolves with the saved entry, rejects when the save is refused. */
  function save(entry, body) {
    return L.outbox.save.update(entry, body).then(function (next) {
      host.upsert(next, body.trace);
      host.paint();
      return next;
    });
  }

  /** A refusal says so and leaves the page as it was. */
  function fail() {
    L.toast.show(L.copy.errors.actionFailed, 'fail');
  }

  /** A place goes on a line of the entry through the model, and what changed is saved. Resolves with the saved entry (the entry itself when nothing changed). */
  function move(entry, kind, target) {
    var line = L.inline.model.fromEntry(entry);
    L.move.model.apply(line, kind, target);
    var body = L.inline.model.changes(line);
    return Object.keys(body).length ? save(entry, body) : Promise.resolve(entry);
  }

  /** A place was picked in the chooser of a swiped row. */
  function pick(entry, kind, target) {
    L.move.chooser.close();
    move(entry, kind, target).catch(fail);
  }

  /** Opens the chooser (a paper overlay) for an entry. A pick goes to onPick(place), closing it with no pick calls nothing. noHere leaves out "this day". */
  function choose(entry, kind, onPick, noHere) {
    var line = L.inline.model.fromEntry(entry);
    var choices = L.move.model.options(line, kind, host.today());
    if (noHere) choices.here = false;
    L.move.chooser.open({ kind: kind, overlay: true, choices: choices, selected: null, today: host.today(), onPick: onPick });
  }

  /** Opens the chooser for the entry of a swiped row, in the kind the swipe asked for. */
  function open(id, kind) {
    var entry = entryOf(id);
    if (!entry || entry.type !== 'task') return;
    choose(entry, kind, function (target) { pick(entry, kind, target); });
  }

  /** The entry is struck out as no longer relevant: it stays on its day with the same id, as a dropped line. */
  function drop(entry) {
    return save(entry, { type: 'dropped' });
  }

  /** Wires the move to its host and starts watching row swipes on the page. select is select mode (its on() says whether it is on). */
  function init(options) {
    host = options.host;
    L.move.swipe.init({ root: options.root, active: function () { return !options.select.on(); }, onSwipe: open });
  }

  L.move.pick = { init: init, move: move, choose: choose, drop: drop, fail: fail };
})();
