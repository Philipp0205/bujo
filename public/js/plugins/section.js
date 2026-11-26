/*
 * The plugin list on the settings page: one row per plugin (name, description, version) with an on/off switch.
 * A tap saves the choice through the registry and flips the row in place, so nothing re-renders.
 * Needs ak-dom.js, plugins/copy.js and plugins/registry.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var P = window.BujoPlugins;

  /** Paints the switch for the current state. */
  function paint(button, on) {
    button.setAttribute('aria-checked', on ? 'true' : 'false');
    button.classList.toggle('ak-toggle-on', on);
    button.textContent = on ? P.copy.on : P.copy.off;
  }

  /** The switch of one plugin. */
  function toggle(manifest, enabled) {
    var button = h('button', { type: 'button', role: 'switch', class: 'ak-toggle bj-plugin-switch', 'data-action': 'toggle-plugin', 'aria-label': P.copy.toggleLabel(manifest.name), onclick: function () {
      var next = !P.registry.isEnabled(manifest.id);
      P.registry.setEnabled(manifest.id, next);
      paint(button, next);
    } });
    paint(button, enabled);
    return button;
  }

  /** One row: the texts on the left, the switch on the right. */
  function row(entry) {
    var m = entry.manifest;
    return h('li', { class: 'bj-plugin-row', 'data-plugin-id': m.id },
      h('div', { class: 'bj-plugin-text' },
        h('p', { class: 'ak-row-title' }, m.name),
        h('p', { class: 'ak-row-sub' }, m.description),
        h('p', { class: 'ak-row-sub' }, P.copy.version(m.version))),
      toggle(m, entry.enabled));
  }

  /** The settings section: a title, one line of hint and the list of plugins. */
  function section() {
    return h('section', { class: 'bj-section', 'data-section': 'plugins' },
      h('h2', { class: 'bj-group-title' }, P.copy.title),
      h('div', { class: 'bj-card', 'data-card': 'plugins' },
        h('div', { class: 'bj-form' }, h('p', { class: 'bj-note' }, P.copy.hint),
          h('ul', { class: 'bj-plugin-list', 'data-list': 'plugins' }, P.registry.list().map(row)))));
  }

  P.section = { section: section };
})();
