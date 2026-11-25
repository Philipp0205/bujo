/*
 * The scan flow: camera, then OCR, then the review sheet, then apply (rapid log) or save (free note).
 * It joins camera.js, review.js, note/sheet.js and api.js.
 * Nothing reaches the log until the person applies or saves: a rapid-log draft lives on the server in memory and is dropped when
 * the review is dismissed, and a free note exists only in the open sheet, with its shrunk photo held in memory. Needs every scan/ file, note/ and photo/.
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

  /** Reads one log-page photo. view is the open log view (a hint for the kind). Resolves with the draft, or rejects with a message for the camera screen. */
  function readPhoto(file, day, view) {
    var errors = L.copy.scan.errors;
    return checkedPhoto(file).then(function (photo) {
      return L.scan.api.scan(photo, day, view).then(function (draft) {
        if (!draft.items.length) throw new Error(L.copy.scan.review.noLines);
        return draft;
      }, function (error) {
        throw new Error(messageOf(error, errors.scanFailed));
      });
    });
  }

  /** Reads one free-note photo and shrinks it for storage. Resolves with { note, match, photo }, or rejects with a message for the camera screen. */
  function readNote(file, day) {
    return checkedPhoto(file).then(function (photo) {
      var shrunk = L.photo.shrink(file);
      return L.scan.api.note(photo, day).then(function (answer) {
        if (!answer.note.body.trim()) throw new Error(L.copy.scan.note.noText);
        return shrunk.then(function (kept) { return { note: answer.note, match: answer.match, photo: kept }; });
      }, function (error) {
        throw new Error(messageOf(error, L.copy.scan.errors.scanFailed));
      });
    });
  }

  /** Swaps the camera for the review. The camera goes first: the kit shows one sheet at a time. A save reports where the lines landed. */
  function showReview(camera, draft, options) {
    camera.close();
    var state = L.scan.model.fromDraft(draft);
    L.scan.review.open(state, {
      check: function (current) { return L.scan.api.check(draft.id, L.scan.model.checkBody(current)); },
      setKind: function (current, kind) { return L.scan.api.setKind(draft.id, kind); },
      apply: function (current) {
        return L.scan.api.apply(draft.id, L.scan.model.applyBody(current)).then(function (result) {
          return L.scan.model.landing(current, result);
        });
      },
      done: options.onApplied
    });
  }

  /** The saved note the review offers to update, with whether to keep its day: an explicit rescan names the note, otherwise the server's match.
   * A day the page did not name is not a new day for the note, so the update keeps the note's own. Null when nothing is offered. */
  function offeredNote(read, options) {
    var found = options.replaceNote || read.match;
    if (!found) return null;
    return { id: found.id, title: found.title, date: found.date, keepDate: !read.note.dateFromPage, explicit: !!options.replaceNote };
  }

  /** Swaps the camera for the free-note sheet, which holds the photo until the person saves. Nothing is written before that. */
  function showNote(camera, read, options) {
    camera.close();
    L.note.sheet.open({
      mode: 'review',
      values: L.note.model.fromSuggestion(read.note, L.copy.note.untitled),
      photo: read.photo,
      match: offeredNote(read, options),
      onSaved: function (entry) { options.onApplied({ view: 'daily', date: entry.date }); }
    });
  }

  /** Reads a photo for the mode the camera is in, then shows the screen that mode ends in, unless the camera was closed meanwhile. */
  function readFor(mode, file, camera, options, isClosed) {
    if (mode === 'note') {
      return readNote(file, options.day).then(function (read) { if (!isClosed()) showNote(camera, read, options); });
    }
    return readPhoto(file, options.day, options.view).then(function (draft) { if (!isClosed()) showReview(camera, draft, options); });
  }

  /**
   * Opens the camera screen. options.day is the day to use when a page names none, options.view the open log view ('daily', 'future'
   * or 'month', a hint for the page kind), options.onApplied({ view, date, month }) runs after a save and says where the lines landed.
   * options.autoCapture opens the phone camera at once, so the tab needs no second tap. options.replaceNote ({ id, title, date }) is a saved
   * note being scanned again: the camera opens in note mode and the review has that note chosen as the one to update. Closing the screen while a photo is read
   * drops the late answer: no review opens and no error shows.
   */
  function start(options) {
    var camera = null;
    var working = false;
    var closed = false;

    function onPhoto(file, mode) {
      if (working) return;
      working = true;
      camera.error('');
      camera.busy(true, file);
      readFor(mode, file, camera, options, function () { return closed; }).then(null, function (error) {
        if (closed) return;
        camera.busy(false);
        camera.error(error.message);
        working = false;
      });
    }

    function onClose() {
      closed = true;
      camera.close();
    }

    camera = L.scan.camera.open({ onPhoto: onPhoto, onClose: onClose, autoCapture: !!options.autoCapture, mode: options.replaceNote ? 'note' : 'rapid' });
  }

  L.scan.flow = { start: start };
})();
