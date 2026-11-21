/*
 * Pure model of the scan flow: photo checks, the review state and the bodies sent to the server.
 * No DOM, no fetch, no strings to show (problems are keys that copy.js words).
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
  var MAX_BYTES = 15 * 1024 * 1024;
  var LOW_CONFIDENCE = 0.8;

  /** The type the server accepts for a file: HEIC and HEIF from a phone often arrive with no type at all. */
  function imageType(file) {
    var type = (file.type || '').toLowerCase();
    if (type === 'image/heif') return 'image/heic';
    if (!type && /\.hei[cf]$/i.test(file.name || '')) return 'image/heic';
    return type;
  }

  /** 'type' or 'size' when the photo cannot be sent, else ''. The server checks again. */
  function photoProblem(file) {
    if (IMAGE_TYPES.indexOf(imageType(file)) < 0) return 'type';
    if (file.size > MAX_BYTES) return 'size';
    return '';
  }

  /** The photo as a Blob whose type is one the server accepts. */
  function uploadable(file) {
    var type = imageType(file);
    return file.type === type ? file : new Blob([file], { type: type });
  }

  /** A line starts ticked when it has a bullet and text and the day has no entry with that title. */
  function defaultInclude(item) {
    return !item.noBullet && item.title !== '' && item.status !== 'duplicate';
  }

  function fromLine(line) {
    return {
      id: line.id,
      type: line.type,
      title: line.title,
      tag: line.tag || '',
      time: line.time || null,
      confidence: line.confidence,
      noBullet: line.noBullet,
      status: line.status,
      target: line.target,
      include: line.include,
      touched: false
    };
  }

  /** The review state of a draft the server sent. */
  function fromDraft(draft) {
    return {
      id: draft.id,
      date: draft.date,
      pageDate: draft.pageDate,
      fallbackDate: draft.fallbackDate,
      dateSource: draft.pageDate ? 'page' : 'fallback',
      items: draft.items.map(fromLine)
    };
  }

  /** Sets the day. The note under it says where it came from: the page, the fallback, or the person. */
  function setDate(state, date) {
    state.date = date;
    if (date === state.pageDate) state.dateSource = 'page';
    else if (!state.pageDate && date === state.fallbackDate) state.dateSource = 'fallback';
    else state.dateSource = 'picked';
  }

  /** Takes the server's answer for a day. A line the person ticked or unticked by hand keeps their choice. */
  function mergeChecks(state, answer) {
    answer.items.forEach(function (check) {
      var item = state.items.filter(function (candidate) { return candidate.id === check.id; })[0];
      if (!item) return;
      item.status = check.status;
      item.target = check.target;
      if (!item.touched) item.include = defaultInclude(item);
    });
  }

  function keptItems(state) {
    return state.items.filter(function (item) { return item.include; });
  }

  /** 'title' when a kept line has no title, 'none' when nothing is kept, else ''. */
  function problem(state) {
    var kept = keptItems(state);
    if (kept.some(function (item) { return item.title.trim() === ''; })) return 'title';
    return kept.length ? '' : 'none';
  }

  function isLowConfidence(item) {
    return item.confidence < LOW_CONFIDENCE;
  }

  function percent(item) {
    return Math.round(item.confidence * 100);
  }

  function lineBody(item) {
    return { id: item.id, type: item.type, title: item.title.trim(), tag: item.tag.trim() || null, time: item.time };
  }

  /** The body of a check: every line, edits included. */
  function checkBody(state) {
    return { date: state.date, items: state.items.map(lineBody) };
  }

  /** The body of an apply: the day and the kept lines only. */
  function applyBody(state) {
    return { date: state.date, items: keptItems(state).map(lineBody) };
  }

  L.scan.model = {
    photoProblem: photoProblem,
    uploadable: uploadable,
    defaultInclude: defaultInclude,
    fromDraft: fromDraft,
    setDate: setDate,
    mergeChecks: mergeChecks,
    keptItems: keptItems,
    problem: problem,
    isLowConfidence: isLowConfidence,
    percent: percent,
    checkBody: checkBody,
    applyBody: applyBody
  };
})();
