/*
 * Calls of the scan flow: read a photo, check the lines against a day, apply the kept lines. Needs core.js.
 * Every function resolves with the parsed body and rejects with an Error that is safe to show.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  function post(path, body) {
    return Bujo.request('POST', path, body, { guarded: true });
  }

  function draftPath(id, step) {
    return '/api/log/scan/' + encodeURIComponent(id) + '/' + step;
  }

  /** Sends the photo. day is the day open in the log: the date to use when the page names none. */
  function scan(file, day) {
    return Bujo.upload('/api/log/scan?date=' + encodeURIComponent(day), file, { guarded: true }).then(function (body) {
      return body.draft;
    });
  }

  /** Asks which lines are duplicates or finish a task on a day. Writes nothing. */
  function check(id, body) {
    return post(draftPath(id, 'check'), body);
  }

  /** Writes the kept lines. Resolves with { date, results }. */
  function apply(id, body) {
    return post(draftPath(id, 'apply'), body);
  }

  L.scan.api = { scan: scan, check: check, apply: apply };
})();
