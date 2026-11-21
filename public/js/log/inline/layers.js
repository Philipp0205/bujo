/*
 * The Back layers of the edit sheet: the sheet itself and the bar popover above it. Each is registered with BujoNav.overlays
 * while it is open, so the phone's Back closes the popover first, then the sheet (saving a non-empty line like Escape, dropping
 * an empty new one). The editor calls update() after every change of its state and never touches history itself.
 * Needs nav/overlays.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var hooks = null;

  /** Back on the sheet: ends the edit like Escape. A save that fails keeps the sheet open, so its layer is put back. */
  function backEdit() {
    hooks.commit().then(function (result) {
      if (!result.ok) BujoNav.overlays.restore('edit');
    });
  }

  /** Back on the popover: closes it and leaves the sheet open. */
  function backPop() {
    hooks.closePop();
  }

  /** Registers or releases each layer to match what is open right now. The popover is always opened after the sheet. */
  function update() {
    var overlays = BujoNav.overlays;
    if (hooks.editing()) overlays.open('edit', backEdit);
    else overlays.release('edit');
    if (hooks.popOpen()) overlays.open('pop', backPop);
    else overlays.release('pop');
  }

  /** hooks: editing() is true while a line is active, popOpen() while a popover is, commit() saves or drops the line, closePop() closes the popover. */
  function init(options) {
    hooks = options;
  }

  L.inline.layers = { init: init, update: update };
})();
