/*
 * The type picker of a closed row: a long press on the marker opens every writer-facing type (glyph and label) on a paper overlay over
 * the log, in the look of the edit sheet's type chooser. Task, done, event and note apply at once (task and done through the done toggle,
 * so ink and haptic match a tap). Moved and Scheduled open the move chooser of a swipe (move/pick.js), so a real move leaves its trace and
 * keeps the id; closing that chooser with no pick changes nothing. A tap on the veil closes the picker with no pick.
 * Needs ak-dom.js, copy.js, glyph.js, inline/type.js (order, option), type/hold.js, move/pick.js and done/toggle.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.type = L.type || {};

  var overlay = null;

  /** Closes the picker, if one is open. */
  function close() {
    if (overlay) overlay.remove();
    overlay = null;
  }

  /** Applies a plain type: a flip between task and done is the one-tap toggle, any other type is a saved change. */
  function apply(entry, type) {
    var flips = (entry.type === 'task' && type === 'done') || (entry.type === 'done' && type === 'task');
    if (flips) L.done.toggle.toggle(entry.id);
    else L.move.pick.save(entry, { type: type }).catch(L.move.pick.fail);
  }

  /** A type was picked for an entry: the picker closes, then the type applies, or the move chooser opens for > and <. */
  function pick(entry, type) {
    close();
    if (type === entry.type) return;
    if (L.move.model.KINDS.migrate === type) L.move.pick.chooseMove(entry, 'migrate');
    else if (L.move.model.KINDS.schedule === type) L.move.pick.chooseMove(entry, 'schedule');
    else apply(entry, type);
  }

  /** The important switch: a full-width row under the types, a * and the word. It flips the flag at once and leaves the type alone. */
  function importantToggle(entry) {
    var copy = L.copy.important;
    return h('button', {
      class: 'important-toggle', type: 'button', 'data-testid': 'important-toggle', 'aria-pressed': entry.important ? 'true' : 'false',
      onclick: function () {
        close();
        L.move.pick.save(entry, { important: !entry.important }).catch(L.move.pick.fail);
      }
    }, h('span', { class: 'important-toggle-star', 'aria-hidden': 'true' }, '*'), h('span', { class: 'important-toggle-label' }, copy.toggle),
    h('span', { class: 'important-toggle-hint' }, copy.hint));
  }

  /** The card of the picker: one option per type, the type of the entry pressed, then the important switch. */
  function card(entry) {
    return h('div', { class: 'type-chooser', role: 'group', 'aria-label': L.copy.inline.typeChooser, 'data-testid': 'type-chooser' },
      L.inline.type.order().map(function (type) { return L.inline.type.option(type, entry.type, function () { pick(entry, type); }); }),
      importantToggle(entry));
  }

  /** Opens the picker for the row with this id. */
  function open(id) {
    var entry = L.move.pick.entryOf(id);
    if (!entry) return;
    close();
    overlay = h('div', {
      class: 'move-overlay type-overlay', 'data-testid': 'type-overlay',
      onclick: function (event) { if (event.target === overlay) close(); }
    }, card(entry));
    document.body.appendChild(overlay);
  }

  /** Starts watching long presses on the markers. select is select mode (its on() says whether it is on). */
  function init(options) {
    L.type.hold.init({ root: options.root, active: function () { return !options.select.on(); }, onHold: open });
  }

  L.type.picker = { init: init, close: close };
})();
