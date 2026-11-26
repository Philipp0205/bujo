/*
 * The plugin registry: first-party plugins register here, the enabled/disabled choice is saved, and the core asks it for the
 * contributions (views, commands, renderers, scan parsers) of the plugins that are on. Plain JS, no DOM. Needs manifest.js and storage.js.
 *
 * A plugin is { manifest, activate(api), deactivate() }. activate and deactivate are optional. The api it gets is only
 * { id, permissions, storage }: no CalDAV and no network, the core owns those. Plugins are on by default.
 *
 * Seam for community plugins (not built, see docs/plugins.md "Decisions"): a loader would fetch a manifest plus a built bundle
 * from a git url and call register() with the result, either through a sandboxed iframe or worker that talks to this api over
 * postMessage, or (the fallback) in-page and trusted at install. register() already validates, so a loader needs nothing else.
 */
(function () {
  'use strict';

  var P = window.BujoPlugins = window.BujoPlugins || {};

  var STATE_KEY = 'bujo.plugins.enabled';

  /** A registry over a localStorage-like backend. The page uses one instance; tests make their own. */
  function create(backend) {
    var plugins = {};
    var order = [];
    var listeners = [];
    var active = {};

    function readState() {
      try { return JSON.parse(backend.getItem(STATE_KEY)) || {}; } catch (e) { return {}; }
    }

    function writeState(state) {
      try { backend.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* blocked store: the choice lasts until reload */ }
    }

    /** Whether a plugin is on: registered, and not switched off. */
    function isEnabled(id) {
      return !!plugins[id] && readState()[id] !== false;
    }

    function emit(id, enabled) {
      listeners.slice().forEach(function (listener) { listener({ type: 'change', id: id, enabled: enabled }); });
    }

    /** The api one plugin gets: its id, its permissions and its own storage, nothing else. */
    function apiFor(manifest) {
      return Object.freeze({ id: manifest.id, permissions: manifest.permissions.slice(), storage: P.storage.forPlugin(backend, manifest.id) });
    }

    function activate(id) {
      var plugin = plugins[id];
      if (active[id] || !plugin.activate) return;
      active[id] = true;
      plugin.activate(apiFor(plugin.manifest));
    }

    function deactivate(id) {
      var plugin = plugins[id];
      if (!active[id]) return;
      active[id] = false;
      if (plugin.deactivate) plugin.deactivate();
    }

    /** Registers a plugin after checking its manifest. A bad manifest or a repeated id throws. Activates it when it is on. */
    function register(plugin) {
      P.manifest.check(plugin && plugin.manifest);
      var id = plugin.manifest.id;
      if (plugins[id]) throw new Error('Plugin already registered: ' + id);
      plugins[id] = plugin;
      order.push(id);
      if (isEnabled(id)) activate(id);
    }

    /** Switches a plugin on or off, saves it, activates or deactivates it and tells the listeners. */
    function setEnabled(id, enabled) {
      if (!plugins[id]) throw new Error('Unknown plugin: ' + id);
      var state = readState();
      state[id] = !!enabled;
      writeState(state);
      if (enabled) activate(id); else deactivate(id);
      emit(id, !!enabled);
    }

    /** Every registered plugin as { manifest, enabled }, in registration order, for Settings. */
    function list() {
      return order.map(function (id) { return { manifest: plugins[id].manifest, enabled: isEnabled(id) }; });
    }

    /** The contributions of one type (views, commands, renderers, scanParsers) from enabled plugins only, each tagged with its plugin id. */
    function contributions(kind) {
      var found = [];
      order.filter(isEnabled).forEach(function (id) {
        ((plugins[id].manifest.contributes || {})[kind] || []).forEach(function (item) {
          found.push(Object.assign({}, item, { pluginId: id }));
        });
      });
      return found;
    }

    /** One command by id, or null when no enabled plugin offers it. */
    function command(id) {
      return contributions('commands').filter(function (item) { return item.id === id; })[0] || null;
    }

    /** Calls listener({ type: 'change', id, enabled }) on every on/off switch. Returns the function that stops it. */
    function onChange(listener) {
      listeners.push(listener);
      return function () { listeners = listeners.filter(function (other) { return other !== listener; }); };
    }

    return { register: register, setEnabled: setEnabled, isEnabled: isEnabled, list: list, contributions: contributions, command: command, onChange: onChange };
  }

  P.create = create;
  P.registry = create(window.localStorage);
})();
