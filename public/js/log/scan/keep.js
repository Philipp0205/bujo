/*
 * Keeps the photo of a scanned log page. The flow starts shrinking the photo (the same 2000px JPEG as a note photo) while the page is
 * read, and once the review is applied, so the page really got saved, this uploads it for the paper page the apply wrote.
 * A review that is dismissed uploads nothing. Needs photo/shrink.js, log/api.js and scan/model.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** The paper page an applied review wrote: { kind, ref, page } as the server files it, or null when it cannot be told. */
  function placeOf(state, result) {
    if (state.kind === 'daily') return { kind: 'day', ref: result.date || state.date, page: state.page || 1 };
    if (state.kind !== 'future') return state.month ? { kind: 'month', ref: state.month, page: 1 } : null;
    var months = state.items.map(function (item) { return item.month; }).filter(Boolean).sort();
    return months.length ? { kind: 'future', ref: months[0], page: 1 } : null;
  }

  /** Starts shrinking the photo. The promise resolves with { blob, url } or null, and never rejects. */
  function begin(file) {
    return L.photo.shrink(file).then(null, function () { return null; });
  }

  /** Uploads the shrunk photo of an applied review, once more after a failure. Never blocks or fails the apply. */
  function upload(shrunk, state, result) {
    var place = placeOf(state, result);
    if (!place) return Promise.resolve(null);
    return shrunk.then(function (kept) {
      if (!kept || !kept.blob) return null;
      var send = function () { return L.api.uploadPagePhoto(place, kept.blob); };
      return send().then(null, send).then(null, function () { return null; });
    });
  }

  L.scan.keep = { begin: begin, upload: upload };
})();
