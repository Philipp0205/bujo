/*
 * Namespaced storage for plugins, over a localStorage-like object. Plain JS, no DOM.
 * Every key a plugin touches is prefixed "bujo.plugin.<id>:", so a plugin cannot reach another plugin's keys or the app's own.
 * A blocked or full store never throws: reads give null, writes are dropped.
 */
(function () {
  'use strict';

  var P = window.BujoPlugins = window.BujoPlugins || {};

  var PREFIX = 'bujo.plugin.';

  /** The storage handed to one plugin. Ids hold no ":", so the id before the first ":" is always the owner. */
  function forPlugin(backend, id) {
    var prefix = PREFIX + id + ':';
    function safe(run, fallback) {
      try { return run(); } catch (e) { return fallback; }
    }
    return {
      get: function (key) { return safe(function () { return backend.getItem(prefix + key); }, null); },
      set: function (key, value) { safe(function () { backend.setItem(prefix + key, String(value)); }); },
      remove: function (key) { safe(function () { backend.removeItem(prefix + key); }); }
    };
  }

  P.storage = { forPlugin: forPlugin };
})();
