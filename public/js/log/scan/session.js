/*
 * The review session of a scan: it shows the pages of one scan one at a time (the log review, the note sheet, or the status sheet of a page
 * that failed or is done), steps between them, and settles each page on its own: Apply on a log page, Save on a note, Skip on either.
 * A page that is applied or saved is done and is never applied twice. Nothing reaches the log before that: a log draft lives on the server in
 * memory, a note only in its open sheet. Each log page uploads its own shrunk photo after its apply (keep.js), for the paper page that apply wrote;
 * a note saves its photo with the note. When every page is settled, or the sheet is dismissed, the scan lands once (options.onApplied) on the
 * last page that was applied or saved. Needs every scan/ file, note/ and photo/. The page is { draft, note, match, photo, shrunk, file, guess, type,
 * state, sheet, status, error, noteValues }, built by scan/flow.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** Drops the sheet that is still animating out, so only one sheet is ever in the DOM. */
  function dropOldLayer() {
    var layer = document.querySelector('.ak-sheet-layer');
    if (layer) layer.remove();
  }

  /** Closes the sheet on screen at once (no slide out), after keeping what the person typed in a note, and forgets the token of its close. */
  function leave(session) {
    var sheet = session.sheet;
    session.token = null;
    if (sheet) {
      if (sheet.values) session.pages[session.index].noteValues = sheet.values();
      sheet.close();
    }
    dropOldLayer();
  }

  /** Shows page `index`, leaving the one on screen. */
  function go(session, index) {
    leave(session);
    session.index = index;
    show(session);
  }

  /** Ends the session once: closes what is open and lands where the last applied or saved page went (nothing when none was). */
  function finish(session) {
    if (session.ended) return;
    session.ended = true;
    session.token = null;
    if (session.sheet) session.sheet.close();
    if (session.landing) session.options.onApplied(L.scan.batch.landing(session.landing, session.pages));
  }

  /** After a page is done: opens the next page still to review (or one that failed), or ends the session when none is left. */
  function advance(session) {
    var next = L.scan.batch.nextOpen(session.pages, session.index);
    if (next < 0) finish(session);
    else go(session, next);
  }

  /** Marks a page applied, saved or skipped. result is where its lines landed (null for a skip). */
  function settle(session, page, status, result) {
    page.status = status;
    if (result) session.landing = result;
    advance(session);
  }

  /** The close handler of the sheet about to open. A close that no step of the session made is a dismissal, which ends the session.
   * The check waits a tick so an apply or save, which closes its sheet and then reports, can move on first. */
  function watch(session) {
    var token = {};
    session.token = token;
    return function () {
      Promise.resolve().then(function () { if (session.token === token) finish(session); });
    };
  }

  /** The page steps of the page on screen. */
  function stepsOf(session, page) {
    return L.scan.steps.row(session.pages, session.index, {
      go: function (index) { go(session, index); },
      skip: function () { settle(session, page, 'skipped', null); }
    });
  }

  /** The top of a page sheet: the page steps (a batch only) above the log or note switch. Switching type shows the same page's other sheet. */
  function topOf(session, page) {
    var typeRow = L.scan.type.row(page, function (type) {
      page.type = type;
      go(session, session.index);
    });
    return h('div', { class: 'scan-batch' }, stepsOf(session, page), typeRow);
  }

  /** Opens the log review of a page. A save settles the page as applied, and uploads this page's own shrunk photo for the paper page it wrote. */
  function openReview(session, page, closed) {
    var draft = page.draft;
    return L.scan.review.open(page.state, {
      typeRow: topOf(session, page),
      check: function (current) { return L.scan.api.check(draft.id, L.scan.model.checkBody(current)); },
      setKind: function (current, kind) { return L.scan.api.setKind(draft.id, kind); },
      apply: function (current) {
        return L.scan.api.apply(draft.id, L.scan.model.applyBody(current)).then(function (result) {
          L.scan.keep.upload(page.shrunk, current, result);
          return L.scan.model.landing(current, result);
        });
      },
      done: function (result) { settle(session, page, 'applied', result); },
      closed: closed
    });
  }

  /** The saved note the review offers to update, with whether to keep its day: an explicit rescan names the note, otherwise the server's match.
   * A day the page did not name is not a new day for the note, so the update keeps the note's own. Null when nothing is offered. */
  function offeredNote(page, options) {
    var found = options.replaceNote || page.match;
    if (!found) return null;
    return { id: found.id, title: found.title, date: found.date, keepDate: !page.note.dateFromPage, explicit: !!options.replaceNote };
  }

  /** Opens the free-note sheet of a page, which holds the photo until the person saves. A save settles the page as saved. */
  function openNote(session, page, closed) {
    return L.note.sheet.open({
      mode: 'review',
      values: page.noteValues || L.note.model.fromSuggestion(page.note, L.copy.note.untitled),
      photo: page.photo,
      match: offeredNote(page, session.options),
      typeRow: topOf(session, page),
      onSaved: function (entry) { settle(session, page, 'saved', { view: 'daily', date: entry.date }); },
      onClosed: closed
    });
  }

  /** Reads the photo of a failed page again. A fresh page replaces it in place, and is shown if the person is still on it. */
  function retry(session, page) {
    return session.read(page.file).then(function (fresh) {
      if (session.ended) return;
      Object.assign(page, fresh);
      if (session.pages[session.index] === page) go(session, session.index);
    });
  }

  /** Opens the status sheet of a page that is not up for review. */
  function openStatus(session, page, closed) {
    return L.scan.status.open(page, stepsOf(session, page), {
      retry: function () { return retry(session, page); },
      again: function () {
        page.status = 'pending';
        go(session, session.index);
      },
      closed: closed
    });
  }

  /** Shows the page at session.index with the sheet that fits its status and type. */
  function show(session) {
    var page = session.pages[session.index];
    var closed = watch(session);
    if (page.state) page.state.otherNumbers = function () { return L.scan.batch.numbers(session.pages, page); };
    if (page.status !== 'pending') session.sheet = openStatus(session, page, closed);
    else session.sheet = page.type === 'note' ? openNote(session, page, closed) : openReview(session, page, closed);
  }

  /**
   * Starts the session on the first page. pages are the pages of the scan, options.onApplied(place) says where the lines landed,
   * options.replaceNote is a saved note being scanned again, read(file) reads a photo again (the Try again of a failed page).
   */
  function open(pages, options, read) {
    show({ pages: pages, options: options, read: read, index: 0, sheet: null, token: null, landing: null, ended: false });
  }

  L.scan.session = { open: open };
})();
