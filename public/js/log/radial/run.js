/*
 * What each bubble of the planet menu does. Every action is an existing one: the done toggle, the move chooser of a swipe, the edit
 * sheet, the type picker, the drop of the migration review and select mode. Nothing new happens to an entry here.
 * Needs done/toggle.js, move/pick.js, type/picker.js and radial/model.js.
 * hooks: open(entry) opens the entry for editing, select(id) starts (or extends) select mode.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.radial = L.radial || {};

  /** Runs the action of a bubble on the entry with this id. */
  function run(key, id, hooks) {
    var entry = L.move.pick.entryOf(id);
    if (!entry) return;
    var actions = {
      done: function () { L.done.toggle.toggle(id); },
      migrate: function () { L.move.pick.chooseMove(entry, 'migrate'); },
      schedule: function () { L.move.pick.chooseMove(entry, 'schedule'); },
      edit: function () { hooks.open(entry); },
      type: function () { L.type.picker.open(id); },
      drop: function () { L.move.pick.drop(entry).catch(L.move.pick.fail); },
      select: function () { hooks.select(id); }
    };
    if (actions[key]) actions[key]();
  }

  L.radial.run = run;
})();
