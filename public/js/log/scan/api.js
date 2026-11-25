/*
 * Calls of the scan flow: read a photo, read a note page, check the lines against a day, apply the kept lines. Needs core.js.
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

  /** Sends the photo. day is the day open in the log: the date to use when the page names none. view ('daily', 'future' or 'month') is the open log view, a hint for the page kind. */
  function scan(file, day, view) {
    var query = '?date=' + encodeURIComponent(day) + (view ? '&view=' + encodeURIComponent(view) : '');
    return Bujo.upload('/api/log/scan' + query, file, { guarded: true }).then(function (body) {
      return body.draft;
    });
  }

  /** Reads the draft again as another page kind. Resolves with the new review. Writes nothing. */
  function setKind(id, kind) {
    return post(draftPath(id, 'kind'), { kind: kind }).then(function (body) {
      return body.draft;
    });
  }

  /** Sends the photo of a free-note page. Resolves with { note, match }: the suggestion { title, date, dateFromPage, body } and the saved note it most likely is (or null). Writes nothing. */
  function note(file, day) {
    return Bujo.upload('/api/log/scan/note?date=' + encodeURIComponent(day), file, { guarded: true }).then(function (body) {
      return { note: body.note, match: body.match || null };
    });
  }

  /** Asks which lines are new, edited (with before and after) or unchanged on a day. Writes nothing. */
  function check(id, body) {
    return post(draftPath(id, 'check'), body);
  }

  /** Writes the kept lines and records the unchanged ones. Resolves with { kind, date, month, results }. */
  function apply(id, body) {
    return post(draftPath(id, 'apply'), body);
  }

  L.scan.api = { scan: scan, setKind: setKind, note: note, check: check, apply: apply };
})();
