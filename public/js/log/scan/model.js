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
      month: line.month || null,
      dayText: line.day ? String(line.day) : '',
      touched: false
    };
  }

  var NEEDS_MONTH = { calendar: true, 'month-task': true };

  /** The month (YYYY-MM) a day belongs to. */
  function monthOfDate(date) {
    return date.slice(0, 7);
  }

  /** Where the kind came from: the detection when the kind is still the detected one, else the person. */
  function kindSourceOf(draft) {
    return draft.kind === draft.detected.kind ? draft.detected.source : 'picked';
  }

  /** The review state of a draft the server sent (or sent again for another kind). A page with no month reads as the month of the fallback day. */
  function fromDraft(draft) {
    return {
      id: draft.id,
      kind: draft.kind,
      kindSource: kindSourceOf(draft),
      date: draft.date,
      pageDate: draft.pageDate,
      fallbackDate: draft.fallbackDate,
      dateSource: draft.pageDate ? 'page' : 'fallback',
      month: draft.month || monthOfDate(draft.fallbackDate),
      items: draft.items.map(fromLine)
    };
  }

  /** Puts a re-read draft (after a kind switch) into the same state object, so the open review keeps its handle. */
  function replaceDraft(state, draft) {
    Object.assign(state, fromDraft(draft));
  }

  /** True when the kind files lines on days of the log (events are allowed there). */
  function allowsEvent(kind) {
    return kind === 'daily' || kind === 'calendar';
  }

  /** Sets the day. The note under it says where it came from: the page, the fallback, or the person. */
  function setDate(state, date) {
    state.date = date;
    if (date === state.pageDate) state.dateSource = 'page';
    else if (!state.pageDate && date === state.fallbackDate) state.dateSource = 'fallback';
    else state.dateSource = 'picked';
  }

  /** Sets the month of a calendar or month-task page. */
  function setMonth(state, month) {
    state.month = month;
  }

  /** A calendar line's day as a whole number 1 to 31, else null. */
  function dayOf(item) {
    var text = String(item.dayText || '').trim();
    if (!/^\d{1,2}$/.test(text)) return null;
    var day = Number(text);
    return day >= 1 && day <= 31 ? day : null;
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

  /** True when a calendar day exists in the month of the page (no 30 February). */
  function dayFits(state, day) {
    return day !== null && day <= Number(L.horizon.model.lastDay(state.month).slice(8));
  }

  /** The first kept line that cannot be filed for the kind, as a key: 'day' (calendar), 'month' (future), else ''. */
  function placeProblem(state, kept) {
    if (state.kind === 'calendar' && kept.some(function (item) { return !dayFits(state, dayOf(item)); })) return 'day';
    if (state.kind === 'future' && kept.some(function (item) { return !item.month; })) return 'month';
    return '';
  }

  /** 'title' when a kept line has no title, 'day' or 'month' when a kept line has no place, 'none' when nothing is kept, else ''. */
  function problem(state) {
    var kept = keptItems(state);
    if (kept.some(function (item) { return item.title.trim() === ''; })) return 'title';
    var place = placeProblem(state, kept);
    if (place) return place;
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

  /** One line as the server reads it. A calendar line carries its day and a future line its month. */
  function lineBody(state, item) {
    var body = { id: item.id, type: item.type, title: item.title.trim(), tags: tagsOf(item), time: item.time };
    if (state.kind === 'calendar') body.day = dayOf(item);
    if (state.kind === 'future') body.month = item.month;
    return body;
  }

  /** The page-level fields of a request: the kind, plus the day (daily) or the month (calendar, month tasks). */
  function pageBody(state) {
    var body = { kind: state.kind };
    if (state.kind === 'daily') body.date = state.date;
    if (NEEDS_MONTH[state.kind]) body.month = state.month;
    return body;
  }

  /** The body of a check: every line, edits included. */
  function checkBody(state) {
    var body = pageBody(state);
    body.items = state.items.map(function (item) { return lineBody(state, item); });
    return body;
  }

  /**
   * The body of an apply: the page and every line. Unchanged lines go as skipped (include false), so the server can record
   * their keys without changing them. Skipped lines go too, so the server matches the page exactly as the check did.
   */
  function applyBody(state) {
    var body = pageBody(state);
    body.items = state.items.map(function (item) {
      var line = lineBody(state, item);
      line.include = item.include && item.status !== 'unchanged';
      return line;
    });
    return body;
  }

  /** Where the person should land after an apply: the Daily view on the day, the Future view, or the Month view on the page's month. */
  function landing(state, result) {
    if (state.kind === 'daily') return { view: 'daily', date: result.date || state.date };
    if (state.kind === 'future') return { view: 'future', month: null };
    return { view: 'month', month: state.month };
  }

  /** The rows in the order the page shows them, with the group each belongs to: [{ item, group }]. Future groups by month, calendar by day. */
  function ordered(state) {
    var grouped = state.kind === 'future' || state.kind === 'calendar';
    var rows = state.items.map(function (item, index) { return { item: item, group: grouped ? groupKey(state, item) : '', index: index }; });
    if (grouped) rows.sort(function (a, b) { return compareGroups(a.group, b.group) || a.index - b.index; });
    return rows;
  }

  /** The key of the group a line sits in: its month (future) or its day, zero padded (calendar). Empty when it has none yet. */
  function groupKey(state, item) {
    if (state.kind === 'future') return item.month || '';
    var day = dayOf(item);
    return day === null ? '' : (day < 10 ? '0' : '') + day;
  }

  /** Orders group keys, those without a place last. */
  function compareGroups(a, b) {
    if (a === b) return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    return a < b ? -1 : 1;
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
    replaceDraft: replaceDraft,
    allowsEvent: allowsEvent,
    setDate: setDate,
    setMonth: setMonth,
    dayOf: dayOf,
    mergeChecks: mergeChecks,
    keptItems: keptItems,
    counts: counts,
    unchangedItems: unchangedItems,
    problem: problem,
    isLowConfidence: isLowConfidence,
    percent: percent,
    checkBody: checkBody,
    applyBody: applyBody,
    landing: landing,
    ordered: ordered,
    changedFields: changedFields
  };
})();
