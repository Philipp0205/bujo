/*
 * The scan flow: camera, then one OCR read, then the review sheet, then apply (log page) or save (note or collection).
 * The photo is read once. The review starts on the guessed type and the person can switch it, so the same read shows as log lines or as a note.
 * It joins camera.js, review.js, type.js, note/sheet.js and api.js.
 * Nothing reaches the log until the person applies or saves: a log draft lives on the server in memory and is dropped when
 * the review is dismissed, and a note exists only in the open sheet, with its shrunk photo held in memory. Needs every scan/ file, note/ and photo/.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  function messageOf(error, fallback) {
    return error && error.message ? error.message : fallback;
  }

  /** The photo checks: a wrong type or size rejects with a message for the camera screen. */
  function checkedPhoto(file) {
    var problem = L.scan.model.photoProblem(file);
    if (problem) return Promise.reject(new Error(L.copy.scan.errors[problem]));
    return Promise.resolve(L.scan.model.uploadable(file));
  }

  /** The page of one answer: the log draft, the note reading and its photo, and the type the review starts on (a rescan of a saved note starts on note). */
  function pageOf(answer, photo, options) {
    var guess = options.replaceNote ? { type: 'note', source: 'rescan' } : answer.draft.guess;
    return { draft: answer.draft, note: answer.note, match: answer.match, photo: photo, guess: guess, type: guess.type, state: null, sheet: null };
  }

  /** Reads one photo once. Resolves with a page that holds both readings (log lines and note), or rejects with a message for the camera screen.
   * The photo is shrunk meanwhile for a note to keep; if that fails the note is saved without it. */
  function readPage(file, day, options, picked) {
    return checkedPhoto(file).then(function (photo) {
      var shrunk = L.photo.shrink(file).then(null, function () { return null; });
      return L.scan.api.scan(photo, day, options.view, options.pinned, picked).then(function (answer) {
        if (!answer.draft.items.length) throw new Error(L.copy.scan.review.noLines);
        if (!answer.note.body.trim()) throw new Error(L.copy.scan.note.noText);
        return shrunk.then(function (kept) { return pageOf(answer, kept, options); });
      }, function (error) {
        throw new Error(messageOf(error, L.copy.scan.errors.scanFailed));
      });
    });
  }

  /** Opens the log review of a page. The state is made once, so edits survive a switch to note and back. A save reports where the lines landed. */
  function openReview(page, options) {
    var draft = page.draft;
    page.state = page.state || L.scan.model.fromDraft(draft);
    return L.scan.review.open(page.state, {
      typeRow: L.scan.type.row(page, function (type) { switchType(page, options, type); }),
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

  /** Opens the free-note sheet of a page, which holds the photo until the person saves. Nothing is written before that. */
  function openNote(page, options) {
    return L.note.sheet.open({
      mode: 'review',
      values: L.note.model.fromSuggestion(page.note, L.copy.note.untitled),
      photo: page.photo,
      match: offeredNote(page, options),
      typeRow: L.scan.type.row(page, function (type) { switchType(page, options, type); }),
      onSaved: function (entry) { options.onApplied({ view: 'daily', date: entry.date }); }
    });
  }

  /** Shows the sheet of the page's current type: the note sheet for a note, else the log review. */
  function showPage(page, options) {
    page.sheet = page.type === 'note' ? openNote(page, options) : openReview(page, options);
  }

  /** Switches a page between log and note without a second scan. The open sheet goes at once (no slide out), so only one is ever in the DOM. */
  function switchType(page, options, type) {
    var layer = document.querySelector('.ak-sheet-layer');
    page.type = type;
    page.sheet.close();
    if (layer) layer.remove();
    showPage(page, options);
  }

  /** Reads a photo, then swaps the camera for the review of the guessed type, unless the camera was closed meanwhile.
   * The camera goes first: the kit shows one sheet at a time. pickedDay is the day the person picked on the camera screen, or null: it replaces options.day and beats a date on the page. */
  function readFor(file, camera, options, isClosed, pickedDay) {
    var day = pickedDay || options.day;
    return readPage(file, day, options, !!pickedDay || !!options.picked).then(function (page) {
      if (isClosed()) return;
      camera.close();
      showPage(page, options);
    });
  }

  /**
   * Opens the camera screen. options.day is the day to use when a page names none, options.view the open log view ('daily', 'future'
   * or 'month', a hint for the page kind), options.onApplied({ view, date, month }) runs after a save and says where the lines landed.
   * options.pinned (a rescan of a day) keeps a page with no date on options.day, never on an earlier day it might continue.
   * options.picked (a rescan of a day) files on options.day even when the page shows another date.
   * options.autoCapture opens the phone camera at once, so the tab needs no second tap. options.replaceNote ({ id, title, date }) is a saved
   * note being scanned again: the review opens on the note type and has that note chosen as the one to update. Closing the screen while a photo is read
   * drops the late answer: no review opens and no error shows.
   */
  function start(options) {
    var camera = null;
    var working = false;
    var closed = false;

    function onPhoto(file, pickedDay) {
      if (working) return;
      working = true;
      camera.error('');
      camera.busy(true, file);
      readFor(file, camera, options, function () { return closed; }, pickedDay).then(null, function (error) {
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

    camera = L.scan.camera.open({ day: options.day, onPhoto: onPhoto, onClose: onClose, autoCapture: !!options.autoCapture });
  }

  L.scan.flow = { start: start };
})();
