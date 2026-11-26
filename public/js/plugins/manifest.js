/*
 * The plugin manifest shape and its check. Plain JS, no DOM, no strings for the UI.
 *
 * @typedef {Object} Contributes
 * @property {Array<{id: string, [key: string]: *}>} [views]        screens or sections; id plus whatever the core asks of a view
 * @property {Array<{id: string, title: string, run: Function}>} [commands]
 * @property {Array<{id: string, [key: string]: *}>} [renderers]    entry row renderers, one per entry type
 * @property {Array<{id: string, [key: string]: *}>} [scanParsers]  one per scan page kind
 *
 * @typedef {Object} Manifest
 * @property {string} id            dotted lower-case id, for example "bujo.bulk-delete"
 * @property {string} name          shown in Settings > Plugins
 * @property {number} version       whole number, bumped on each release
 * @property {string} description   one line, shown in Settings > Plugins
 * @property {string[]} permissions what the plugin may do; "network" is the only one so far and is off unless listed
 * @property {Contributes} contributes
 */
(function () {
  'use strict';

  var P = window.BujoPlugins = window.BujoPlugins || {};

  var ID = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
  var KINDS = ['views', 'commands', 'renderers', 'scanParsers'];
  var PERMISSIONS = ['network'];

  function isText(value) { return typeof value === 'string' && value.trim() !== ''; }

  /** Problems with one contribution list: an array of objects, each with a text id, unique in the list. */
  function checkList(kind, list) {
    if (!Array.isArray(list)) return [kind + ' must be an array'];
    var seen = {};
    var problems = [];
    list.forEach(function (item, at) {
      if (!item || typeof item !== 'object' || !isText(item.id)) { problems.push(kind + '[' + at + '] needs an id'); return; }
      if (seen[item.id]) problems.push(kind + ' id "' + item.id + '" is listed twice');
      seen[item.id] = true;
      if (kind === 'commands' && typeof item.run !== 'function') problems.push('command "' + item.id + '" needs a run function');
    });
    return problems;
  }

  /** All problems of a manifest, as a list of short sentences. Empty means it is good. */
  function problems(manifest) {
    if (!manifest || typeof manifest !== 'object') return ['manifest must be an object'];
    var found = [];
    if (!isText(manifest.id) || !ID.test(manifest.id)) found.push('id must look like "vendor.name"');
    if (!isText(manifest.name)) found.push('name is required');
    if (!isText(manifest.description)) found.push('description is required');
    if (typeof manifest.version !== 'number' || manifest.version < 1 || Math.floor(manifest.version) !== manifest.version) found.push('version must be a whole number from 1');
    if (!Array.isArray(manifest.permissions)) found.push('permissions must be an array');
    else manifest.permissions.forEach(function (name) { if (PERMISSIONS.indexOf(name) < 0) found.push('unknown permission "' + name + '"'); });
    var contributes = manifest.contributes;
    if (!contributes || typeof contributes !== 'object') return found.concat('contributes is required');
    Object.keys(contributes).forEach(function (kind) { if (KINDS.indexOf(kind) < 0) found.push('unknown contribution type "' + kind + '"'); });
    KINDS.forEach(function (kind) { if (contributes[kind] !== undefined) found = found.concat(checkList(kind, contributes[kind])); });
    return found;
  }

  /** Throws one error naming the plugin and every problem, so a bad manifest is refused when it registers. */
  function check(manifest) {
    var found = problems(manifest);
    if (found.length) throw new Error('Invalid plugin manifest' + (manifest && manifest.id ? ' (' + manifest.id + ')' : '') + ': ' + found.join('; '));
  }

  P.manifest = { KINDS: KINDS, problems: problems, check: check };
})();
