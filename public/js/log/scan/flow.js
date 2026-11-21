/*
 * The scan flow: camera, then OCR, then the review sheet, then apply (rapid log) or save (free note).
 * It joins camera.js, review.js, note/sheet.js and api.js.
 * Nothing reaches the log until the person applies or saves: a rapid-log draft lives on the server in memory and is dropped when
 * the review is dismissed, and a free note exists only in the open sheet. Needs every scan/ file and note/.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  function messageOf(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  /** The photo checks both modes share: a wrong type or size rejects with a message for the camera screen. */
  function checkedPhoto(file) {
    var problem = L.scan.model.photoProblem(file);
    if (problem) return Promise.reject(new Error(L.copy.scan.errors[problem]));
    return Promise.resolve(L.scan.model.uploadable(file));
  }

  /** Reads one rapid-log photo. Resolves with the draft, or rejects with a message for the camera screen. */
  function readPhoto(file, day) {
    var errors = L.copy.scan.errors;
    return checkedPhoto(file).then(function (photo) {
      return L.scan.api.scan(photo, day).then(function (draft) {
        if (!draft.items.length) throw new Error(L.copy.scan.review.noLines);
        return draft;
      }, function (error) {
        throw new Error(messageOf(error, errors.scanFailed));
      });
    });
  }

  /** Reads one free-note photo. Resolves with the suggestion, or rejects with a message for the camera screen. */
  function readNote(file, day) {
    return checkedPhoto(file).then(function (photo) {
      return L.scan.api.note(photo, day).then(function (note) {
        if (!note.body.trim()) throw new Error(L.copy.scan.note.noText);
        return note;
      }, function (error) {
        throw new Error(messageOf(error, L.copy.scan.errors.scanFailed));
      });
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

  /** Swaps the camera for the free-note sheet. Nothing is written until the person saves it. */
  function showNote(camera, note, options) {
    camera.close();
    L.note.sheet.open({
      mode: 'review',
      values: L.note.model.fromSuggestion(note, L.copy.note.untitled),
      onSaved: function (entry) { options.onApplied({ date: entry.date }); }
    });
  }

  /** Reads a photo for the mode the camera is in, then shows the screen that mode ends in. */
  function readFor(mode, file, camera, options) {
    if (mode === 'note') return readNote(file, options.day).then(function (note) { showNote(camera, note, options); });
    return readPhoto(file, options.day).then(function (draft) { showReview(camera, draft, options); });
  }

  /** Opens the camera screen. options.day is the day open in the log, options.onApplied({ date }) runs after a save. */
  function start(options) {
    var camera = null;
    var working = false;

    function onPhoto(file, mode) {
      if (working) return;
      working = true;
      camera.error('');
      camera.busy(true);
      readFor(mode, file, camera, options).then(null, function (error) {
        camera.busy(false);
        camera.error(error.message);
        working = false;
      });
    }

    camera = L.scan.camera.open({ onPhoto: onPhoto, onClose: function () { camera.close(); } });
  }

  L.scan.flow = { start: start };
})();
