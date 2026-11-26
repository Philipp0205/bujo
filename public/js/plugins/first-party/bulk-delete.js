/*
 * First-party plugin: bulk delete in the daily log's select mode. It contributes the command "log.select.delete", which the select
 * bar and select mode use. Switched off, the bar has no Delete button. The delete confirm and the delete loop stay in
 * log/select/confirm.js and log/select/remove.js, which are only called when the command runs.
 * Needs plugins/registry.js.
 */
(function () {
  'use strict';

  var P = window.BujoPlugins;

  /** Asks first with the count, then removes the picked entries. ctx: { entries, host, done(failed) }. */
  function run(ctx) {
    var L = window.BujoLog;
    L.select.confirm.open({
      count: ctx.entries.length,
      onConfirm: function () { L.select.remove.removeAll(ctx.entries, ctx.host).then(ctx.done); }
    });
  }

  P.registry.register({
    manifest: {
      id: 'bujo.bulk-delete',
      name: P.copy.bulkDelete.name,
      version: 1,
      description: P.copy.bulkDelete.description,
      permissions: [],
      contributes: { commands: [{ id: 'log.select.delete', title: P.copy.bulkDelete.command, run: run }] }
    }
  });
})();
