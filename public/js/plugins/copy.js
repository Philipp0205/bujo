/*
 * Plugin copy: every string of Settings > Plugins and of the first-party plugins' manifests, in one place. Plain JS, no build step.
 */
(function () {
  'use strict';

  var P = window.BujoPlugins = window.BujoPlugins || {};

  P.copy = {
    title: 'Plugins',
    hint: 'Switch features on or off. Saved on this phone only.',
    on: 'On',
    off: 'Off',
    version: function (n) { return 'Version ' + n; },
    toggleLabel: function (name) { return name + ' on or off'; },
    bulkDelete: {
      name: 'Bulk delete',
      description: 'Delete several entries at once from the daily log\'s select mode.',
      command: 'Delete selected entries'
    }
  };
})();
