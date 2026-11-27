/*
 * Calls of the scan flow: read a photo (log review and note reading in one answer), check the lines against a day, apply the kept lines. Needs core.js.
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

  /** Sends the photo. day is the day open in the log: the date to use when the page names none. view ('daily', 'future' or 'month') is the open log view, a hint for the page kind.
   * pinned says the day was named on purpose (a rescan of a day), so a page with no date is never taken as the continuation of an earlier day.
   * picked says the person chose the day on the scan screen, so it beats a date read from the page header.
   * Resolves with { draft, note, match }: the log review, the free-note suggestion { title, date, dateFromPage, body } read from the same text,
   * and the saved note the page most likely is (or null). */
  function scan(file, day, view, pinned, picked) {
    var query = '?date=' + encodeURIComponent(day) + (view ? '&view=' + encodeURIComponent(view) : '') + (pinned ? '&pinned=1' : '') + (picked ? '&picked=1' : '');
    return Bujo.upload('/api/log/scan' + query, file, { guarded: true }).then(function (body) {
      return { draft: body.draft, note: body.note, match: body.match || null };
    });
  }

  /** Reads the draft again as another page kind. Resolves with the new review. Writes nothing. */
  function setKind(id, kind) {
    return post(draftPath(id, 'kind'), { kind: kind }).then(function (body) {
      return body.draft;
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

  L.scan.api = { scan: scan, setKind: setKind, check: check, apply: apply };
})();
