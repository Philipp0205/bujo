/*
 * The scan flow: camera, then OCR, then the review sheet, then apply. It joins camera.js, review.js and api.js.
 * Nothing reaches the log until the person applies: the draft lives on the server in memory and is dropped when
 * the review is dismissed. Needs every scan/ file.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  function messageOf(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  /** Reads one photo. Resolves with the draft, or rejects with a message for the camera screen. */
  function readPhoto(file, day) {
    var errors = L.copy.scan.errors;
    var problem = L.scan.model.photoProblem(file);
    if (problem) return Promise.reject(new Error(errors[problem]));
    return L.scan.api.scan(L.scan.model.uploadable(file), day).then(function (draft) {
      if (!draft.items.length) throw new Error(L.copy.scan.review.noLines);
      return draft;
    }, function (error) {
      throw new Error(messageOf(error, errors.scanFailed));
    });
  }

  /** Swaps the camera for the review. The camera goes first: the kit shows one sheet at a time. */
  function showReview(camera, draft, options) {
    camera.close();
    var state = L.scan.model.fromDraft(draft);
    L.scan.review.open(state, {
      check: function (current) { return L.scan.api.check(draft.id, L.scan.model.checkBody(current)); },
      apply: function (current) { return L.scan.api.apply(draft.id, L.scan.model.applyBody(current)); },
      done: options.onApplied
    });
  }

  /** Opens the camera screen. options.day is the day open in the log, options.onApplied(result) runs after a save. */
  function start(options) {
    var camera = null;
    var working = false;

    function onPhoto(file) {
      if (working) return;
      working = true;
      camera.error('');
      camera.busy(true);
      readPhoto(file, options.day).then(function (draft) {
        showReview(camera, draft, options);
      }, function (error) {
        camera.busy(false);
        camera.error(error.message);
        working = false;
      });
    }

    camera = L.scan.camera.open({ onPhoto: onPhoto, onClose: function () { camera.close(); } });
  }

  L.scan.flow = { start: start };
})();
