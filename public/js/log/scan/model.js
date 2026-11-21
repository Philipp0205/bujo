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

  /**
   * A line starts ticked when it would write something and can be trusted: a new line with a bullet and text, or an edit
   * with a bullet that the app did not also change. An unchanged line never writes, so it is never ticked.
   */
  function defaultInclude(item) {
    if (item.noBullet) return false;
    if (item.status === 'new') return item.title !== '';
    return item.status === 'edited' && !item.contested;
  }

  function fromLine(line) {
    return {
      id: line.id,
      type: line.type,
      title: line.title,
      tags: (line.tags || []).slice(),
      tagText: L.tags.join(line.tags || []),
      time: line.time || null,
      confidence: line.confidence,
      noBullet: line.noBullet,
      status: line.status,
      target: line.target,
      before: line.before,
      after: line.after,
      contested: line.contested,
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

  /** Takes the server's answer for a day. A line the person ticked or unticked by hand keeps their choice, except an unchanged one. */
  function mergeChecks(state, answer) {
    answer.items.forEach(function (check) {
      var item = state.items.filter(function (candidate) { return candidate.id === check.id; })[0];
      if (!item) return;
      item.status = check.status;
      item.target = check.target;
      item.before = check.before;
      item.after = check.after;
      item.contested = check.contested;
      if (item.status === 'unchanged') {
        item.include = false;
        item.touched = false;
      } else if (!item.touched) {
        item.include = defaultInclude(item);
      }
    });
  }

  /** The lines that will be written: kept, and new or edited. An unchanged line writes nothing. */
  function keptItems(state) {
    return state.items.filter(function (item) { return item.include && item.status !== 'unchanged'; });
  }

  /** How many kept lines add an entry and how many change one. */
  function counts(state) {
    var kept = keptItems(state);
    var updated = kept.filter(function (item) { return item.status === 'edited'; }).length;
    return { created: kept.length - updated, updated: updated };
  }

  /** The lines the server found unchanged. The review folds them into one count. */
  function unchangedItems(state) {
    return state.items.filter(function (item) { return item.status === 'unchanged'; });
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

  /** The tags a row holds: its text field read as a list. A field left as shown keeps the original list. */
  function tagsOf(item) {
    return L.tags.fromField(item.tagText, item.tags);
  }

  function lineBody(item) {
    return { id: item.id, type: item.type, title: item.title.trim(), tags: tagsOf(item), time: item.time };
  }

  /** The body of a check: every line, edits included. */
  function checkBody(state) {
    return { date: state.date, items: state.items.map(lineBody) };
  }

  /**
   * The body of an apply: the day and every line. Unchanged lines go as skipped (include false), so the server can record
   * their keys without changing them. Skipped lines go too, so the server matches the day exactly as the check did.
   */
  function applyBody(state) {
    var items = state.items.map(function (item) {
      var body = lineBody(item);
      body.include = item.include && item.status !== 'unchanged';
      return body;
    });
    return { date: state.date, items: items };
  }

  /** What the "was" row shows of an edited line: the old type and title, plus the old tags or time when the paper writes different ones. */
  function changedFields(item) {
    var before = item.before;
    if (item.status !== 'edited' || !before) return null;
    var tags = tagsOf(item);
    var was = before.tags || [];
    return {
      type: before.type,
      title: before.title,
      tags: tags.length && !L.tags.same(was, tags) ? { value: was } : null,
      time: item.time && before.time !== item.time ? { value: before.time } : null
    };
  }

  L.scan.model = {
    photoProblem: photoProblem,
    uploadable: uploadable,
    defaultInclude: defaultInclude,
    fromDraft: fromDraft,
    setDate: setDate,
    mergeChecks: mergeChecks,
    keptItems: keptItems,
    counts: counts,
    unchangedItems: unchangedItems,
    problem: problem,
    isLowConfidence: isLowConfidence,
    percent: percent,
    checkBody: checkBody,
    applyBody: applyBody,
    changedFields: changedFields
  };
})();
