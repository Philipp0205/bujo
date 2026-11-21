/*
 * Select mode of the rapid log: a long press on a row starts it, a tap on a row ticks or unticks it, and Copy writes the ticked
 * entries to the clipboard as paper lines. While it is on, the page shows the select bar instead of the header.
 * The phone's Back leaves it, through the one overlay stack (BujoNav.overlays, name "select"), and copies nothing.
 * Needs select/model.js, select/press.js, select/bar.js, clipboard.js, the inline editor (settle) and nav/overlays.js.
 * host: entries() the entries on screen, draw() redraws the page.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  var host = null;
  var on = false;

  /** Leaves select mode: nothing ticked, the header back, the Back layer released. Cancel, a good copy and Back all end here. */
  function exit() {
    on = false;
    L.select.model.clear();
    BujoNav.overlays.release('select');
    host.draw();
  }

  /** Goes into select mode with the pressed entry ticked. The Back layer opens inside the press, so one Back leaves it. */
  function enter(entry) {
    on = true;
    L.select.model.add(entry);
    BujoNav.overlays.open('select', exit);
    host.draw();
  }

  /** The entry with this id among the ones on screen. */
  function entryOf(id) {
    return host.entries().filter(function (entry) { return entry.id === id; })[0] || null;
  }

  /** A long press on a row: starts select mode (after any open edit line is saved or dropped), or ticks one more row. */
  function hold(id) {
    var entry = entryOf(id);
    if (!entry) return;
    if (!on) { L.inline.editor.settle(function () { enter(entry); }); return; }
    L.select.model.add(entry);
    host.draw();
  }

  /** A tap on a row while selecting: ticks it or unticks it. The count may fall to 0, the bar stays. */
  function toggle(entry) {
    L.select.model.toggle(entry);
    host.draw();
  }

  /** Select day: ticks every entry of the day of the one toggled last. */
  function tickDay() {
    L.select.model.addDay(host.entries());
    host.draw();
  }

  /** Copy: the ticked entries as paper lines. A good copy ends select mode, a failed one keeps it. */
  function copy() {
    var picked = L.select.model.pick(host.entries());
    if (!picked.length) return;
    L.clipboard.copy(picked).then(function (ok) { if (ok) exit(); });
  }

  /** The select bar for the page, with the current count. */
  function bar() {
    return L.select.bar.build({
      count: L.select.model.pick(host.entries()).length,
      onCancel: exit,
      onDay: tickDay,
      onCopy: copy
    });
  }

  /** Wires select mode to its host and starts watching long presses on the page. */
  function init(options) {
    host = options.host;
    L.select.press.init({ root: options.root, onHold: hold });
  }

  L.select.mode = {
    init: init, toggle: toggle, bar: bar,
    on: function () { return on; },
    ticked: function (entry) { return L.select.model.has(entry.id); }
  };
})();
