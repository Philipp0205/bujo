/*
 * Calls to /api/entries. Needs core.js (Bujo.request). A 401 sends the person to sign in.
 * Every function resolves with the parsed data and rejects with an Error that is safe to show.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  function call(method, path, body) {
    return Bujo.request(method, path, body, { guarded: true });
  }

  /** The entries from one day to another, both included. */
  function list(from, to) {
    return call('GET', '/api/entries?from=' + from + '&to=' + to).then(function (body) {
      return body.entries;
    });
  }

  function create(values) {
    return call('POST', '/api/entries', values).then(function (body) {
      return body.entry;
    });
  }

  function update(id, values) {
    return call('PATCH', '/api/entries/' + encodeURIComponent(id), values).then(function (body) {
      return body.entry;
    });
  }

  /** Asks the server to push an entry again after a failed sync. Resolves with the entry as it is now (pending). */
  function retrySync(id) {
    return call('POST', '/api/entries/' + encodeURIComponent(id) + '/sync').then(function (body) {
      return body.entry;
    });
  }

  L.api = { list: list, create: create, update: update, retrySync: retrySync };
})();
