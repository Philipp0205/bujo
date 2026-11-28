/*
 * The scan flow: camera, then one OCR read per page, then the review session, then apply (log page) or save (note or collection) per page.
 * Each photo is read once, one after another, by our own server. The review starts on the guessed type and the person can switch it, so the same
 * read shows as log lines or as a note. A page that cannot be read stays in the batch as a failed page (scan/session.js lets the person retry it)
 * so it never costs the others; a lone photo that fails shows its message on the camera screen as before.
 * Each page starts its own shrink of its photo (keep.begin) while it is read: a note keeps the shrunk photo in its sheet, and after a log apply
 * the session uploads that page's photo for its own paper page (keep.js), so every page of a batch keeps its own photo. A Retry reads and shrinks anew.
 * It joins camera.js, session.js, keep.js and api.js. Needs every scan/ file, note/ and photo/.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  function messageOf(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  /** The message of a failed read. The server being unable to read the page (502, 503: the reader is off, slow or failed) gets the friendly
   * sentence, never the server's own words; a problem with the photo itself keeps its message. */
  function scanMessage(error) {
    var unavailable = error && (error.status === 502 || error.status === 503);
    return unavailable ? L.copy.scan.errors.scanFailed : messageOf(error, L.copy.scan.errors.scanFailed);
  }

  /** The photo checks: a wrong type or size rejects with a message for the camera screen. */
  function checkedPhoto(file) {
    var problem = L.scan.model.photoProblem(file);
    if (problem) return Promise.reject(new Error(L.copy.scan.errors[problem]));
    return Promise.resolve(L.scan.model.uploadable(file));
  }

  /** The page of one answer: the log draft and its review state, the note reading and its shrunk photo (and the shrink promise, for keeping a
   * log page), the file it came from, and the type the review starts on (a rescan of a saved note starts on note). */
  function pageOf(answer, photo, file, options, shrunk) {
    var guess = options.replaceNote ? { type: 'note', source: 'rescan' } : answer.draft.guess;
    return {
      draft: answer.draft, note: answer.note, match: answer.match, photo: photo, shrunk: shrunk, file: file, guess: guess, type: guess.type,
      state: L.scan.model.fromDraft(answer.draft), sheet: null, status: 'pending', error: '', noteValues: null
    };
  }

  /** A page that could not be read: it keeps its file and the message, and shows as a failed page in the review. */
  function failedPage(file, error) {
    return { draft: null, note: null, match: null, photo: null, shrunk: null, file: file, guess: null, type: 'log', state: null, sheet: null, status: 'failed', error: error.message, noteValues: null };
  }

  /** Reads one photo once. Resolves with a page that holds both readings (log lines and note), or rejects with a message.
   * The photo is shrunk meanwhile (keep.begin); if that fails the page is saved without a photo. */
  function readPage(file, day, options, picked) {
    return checkedPhoto(file).then(function (photo) {
      var shrunk = L.scan.keep.begin(file);
      return L.scan.api.scan(photo, day, options.view, options.pinned, picked).then(function (answer) {
        if (!answer.draft.items.length) throw new Error(L.copy.scan.review.noLines);
        if (!answer.note.body.trim()) throw new Error(L.copy.scan.note.noText);
        return shrunk.then(function (kept) { return pageOf(answer, kept, file, options, shrunk); });
      }, function (error) {
        throw new Error(scanMessage(error));
      });
    });
  }

  /** Reads the files one after another. report(index) runs before each read. A lone file that fails rejects (the camera shows it);
   * in a batch a failed file becomes a failed page and the rest are still read. Stops early when isClosed() says the camera went. */
  function readAll(files, read, report, isClosed) {
    var pages = [];
    return files.reduce(function (chain, file, index) {
      return chain.then(function () {
        if (isClosed()) return null;
        report(index);
        return read(file).then(function (page) { pages.push(page); }, function (error) {
          if (files.length === 1) throw error;
          pages.push(failedPage(file, error));
        });
      });
    }, Promise.resolve()).then(function () { return pages; });
  }

  /**
   * Opens the camera screen. options.day is the day to use when a page names none, options.view the open log view ('daily', 'future'
   * or 'month', a hint for the page kind), options.onApplied({ view, date, month }) runs once after the scan is done and says where the lines landed.
   * options.pinned (a rescan of a day) keeps a page with no date on options.day, never on an earlier day it might continue.
   * options.picked (a rescan of a day) files on options.day even when the page shows another date.
   * options.autoCapture opens the phone camera at once, so the tab needs no second tap. options.replaceNote ({ id, title, date }) is a saved
   * note being scanned again: the review opens on the note type and has that note chosen as the one to update. Closing the screen while photos are read
   * drops the late answer: no review opens and no error shows.
   */
  function start(options) {
    var camera = null;
    var working = false;
    var closed = false;

    function isClosed() { return closed; }

    /** The step line for photo `index` of `total`: the page of a batch, or nothing (the default line) for one photo. */
    function stepText(index, total) {
      return total > 1 ? L.copy.scan.progress.page(index + 1, total) : undefined;
    }

    function onPhotos(files, pickedDay) {
      if (working) return;
      if (L.scan.batch.exceeds(files.length)) {
        camera.error(L.copy.scan.errors.tooMany(L.scan.batch.MAX_PAGES));
        return;
      }
      working = true;
      camera.error('');
      camera.busy(true, files[0], stepText(0, files.length));
      var read = function (file) { return readPage(file, pickedDay || options.day, options, !!pickedDay || !!options.picked); };
      var report = function (index) { if (index > 0) camera.reading(files[index], stepText(index, files.length)); };
      readAll(files, read, report, isClosed).then(function (pages) {
        if (closed) return;
        camera.close();
        L.scan.session.open(pages, options, read);
      }, function (error) {
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

    camera = L.scan.camera.open({ day: options.day, onPhotos: onPhotos, onClose: onClose, autoCapture: !!options.autoCapture });
  }

  L.scan.flow = { start: start };
})();
