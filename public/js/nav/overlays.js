/*
 * The overlay layers of a page and the phone's Back button. Every open layer (a kit sheet, the photo view, the scan camera, the edit
 * sheet, a bar popover) registers here with the function that closes it. The count of open layers goes to
 * AppKit.nav.syncOverlayHistory, which keeps one history entry per layer, so Back closes the top layer and stays in the app.
 * A layer that the app closes itself (Save, Done, a tap outside) releases its name, and the kit drops the extra entry.
 * Needs ak-nav.js. A layer is never re-ordered once it is open. Nothing here knows what a layer looks like.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};
  var layers = [];
  var queued = false;

  /** A layer that Back has asked to close is not counted: its entry is already gone, even while its close is still running. */
  function counted(layer) {
    return !layer.closing;
  }

  /** How many layers still need a history entry. The kit reads it again on every Back. */
  function depth() {
    return layers.filter(counted).length;
  }

  /** Back was pressed: closes the top counted layer only. The kit has already taken that layer's entry. */
  function onPop() {
    var open = layers.filter(counted);
    var top = open[open.length - 1];
    if (!top) return;
    top.closing = true;
    top.close();
    schedule();
  }

  /** Brings history in line with the open layers. */
  function flush() {
    queued = false;
    AppKit.nav.syncOverlayHistory({ depth: depth, onPop: onPop });
  }

  /** Syncs once after the current task, so one layer closing as another opens (a swap) costs no history change. */
  function schedule() {
    if (queued) return;
    queued = true;
    window.setTimeout(flush, 0);
  }

  /** Registers an open layer under a name, or updates how it closes when the name is already open. close() must end in release(name).
   * The history entry is pushed at once, inside the tap that opened the layer, so the browser counts it as the person's own. */
  function open(name, close) {
    var known = layers.filter(function (layer) { return layer.name === name; })[0];
    if (known) { known.close = close; return; }
    layers.push({ name: name, close: close, closing: false });
    flush();
  }

  /** The layer is gone, closed by the app or by Back. Unknown names are ignored. */
  function release(name) {
    layers = layers.filter(function (layer) { return layer.name !== name; });
    schedule();
  }

  /** A close that Back asked for did not happen (a save failed): the layer is open again and needs its entry back. */
  function restore(name) {
    layers.forEach(function (layer) { if (layer.name === name) layer.closing = false; });
    schedule();
  }

  /**
   * Shows a kit sheet and registers it as a layer. Whatever closes the sheet (Back, the scrim, a swipe, Escape, a button)
   * releases the layer. Returns the kit's handle, or null when a sheet is already open.
   */
  function showSheet(node, options) {
    var settings = Object.assign({}, options);
    var after = settings.onClose;
    settings.onClose = function () {
      release('sheet');
      if (typeof after === 'function') after();
    };
    var sheet = AppKit.sheet.show(node, settings);
    if (sheet) open('sheet', sheet.close);
    return sheet;
  }

  N.overlays = { open: open, release: release, restore: restore, showSheet: showSheet };
})();
