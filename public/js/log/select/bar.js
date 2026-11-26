/*
 * The top bar of select mode, on paper: Cancel, the count, "Select day", Copy and Delete. It replaces the page header while selecting.
 * It builds a node and calls back, nothing else. Needs ak-dom.js and copy.js.
 * options: count, onCancel(), onDay(), onCopy(), onDelete(). Copy and Delete are off while the count is 0. Without onDelete (the bulk-delete plugin is off) there is no Delete button.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.select = L.select || {};

  /** One text button of the bar. */
  function button(name, label, onclick, extra) {
    return h('button', Object.assign({ class: 'select-btn', type: 'button', 'data-action': name, onclick: onclick }, extra || {}), label);
  }

  /** The bar. */
  function build(options) {
    var words = L.copy.select;
    var del = options.onDelete
      ? button('select-delete', words.remove, options.onDelete, { 'data-testid': 'select-delete', disabled: options.count === 0 })
      : null;
    return h('div', { class: 'select-bar', role: 'toolbar', 'aria-label': words.barLabel, 'data-testid': 'select-bar' },
      button('select-cancel', words.cancel, options.onCancel),
      h('span', { class: 'select-count', 'data-testid': 'select-count', role: 'status' }, words.count(options.count)),
      button('select-day', words.day, options.onDay),
      button('select-copy', words.copy, options.onCopy, { class: 'select-btn select-copy', disabled: options.count === 0 }),
      del);
  }

  L.select.bar = { build: build };
})();
