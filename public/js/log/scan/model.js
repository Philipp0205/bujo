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

  var CLOSED_TYPES = ['done', 'migrated', 'scheduled', 'dropped'];

  /** True when the paper closes a task that is still open in the app: that symbol wins over an app edit of title or tags. */
  function paperClosesTask(item) {
    return !!item.before && !!item.after && item.before.type === 'task' && CLOSED_TYPES.indexOf(item.after.type) >= 0;
  }

  /**
   * A line starts ticked when it would write something and can be trusted: a new line with a bullet and text, or an edit
   * with a bullet that the app did not also change (a paper close of an open task counts as trusted). An unchanged line never writes, so it is never ticked.
   */
  function defaultInclude(item) {
    if (item.noBullet) return false;
    if (item.needsDay && dayOf(item) === null) return false;
    if (isPast(item)) return false;
    if (item.status === 'new') return item.title !== '';
    return item.status === 'edited' && (!item.contested || paperClosesTask(item));
  }

  /** Where the scan flow reads today from. Tests replace it to fix the day. */
  var clock = function () { return new Date(); };

  /** Sets the clock: a function that returns a Date. */
  function setClock(now) {
    clock = now;
  }

  /** True when a calendar line's day, or a future line's month, lies before today (the person's local day). A line with no place is not past. */
  function isPast(item) {
    var today = L.dates.todayIso(clock());
    if (item.dated === 'future') return !!item.month && item.month < today.slice(0, 7);
    if (item.dated !== 'calendar') return false;
    var day = dayOf(item);
    return day !== null && item.pageMonth + '-' + (day < 10 ? '0' : '') + day < today;
  }

  function fromLine(line, kind, month) {
    var item = newItem(line, kind, month);
    item.include = line.include && !isPast(item);
    return item;
  }

  function newItem(line, kind, month) {
    return {
      dated: kind === 'calendar' || kind === 'future' ? kind : null,
      pageMonth: month,
      needsDay: kind === 'calendar' && !line.day,
      id: line.id,
      type: line.type,
      title: line.title,
      tags: (line.tags || []).slice(),
      time: line.time || null,
      important: line.important === true,
      confidence: line.confidence,
      noBullet: line.noBullet,
      status: line.status,
      target: line.target,
      before: line.before,
      after: line.after,
      contested: line.contested,
      moveTo: line.moveTo || null,
      traced: line.traced === true,
      movedFrom: line.movedFrom || null,
      offPaper: line.offPaper === true,
      unmatched: false,
      wasMatch: null,
      include: line.include,
      month: line.month || null,
      dayText: line.day ? String(line.day) : '',
      touched: false,
      indent: line.indent === 1 ? 1 : 0
    };
  }

  /** True when the line may nest under the line above: only a daily page nests, and the first line has nothing above it. */
  function canNest(state, item) {
    return state.kind === 'daily' && state.items.indexOf(item) > 0;
  }

  /** The indent a row draws and sends: what the paper wrote (there is no nest switch in the review), 1 only while the line can nest. */
  function indentOf(state, item) {
    return item.indent === 1 && canNest(state, item) ? 1 : 0;
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
    var month = draft.month || monthOfDate(draft.fallbackDate);
    return {
      id: draft.id,
      kind: draft.kind,
      kindSource: kindSourceOf(draft),
      date: draft.date,
      pageDate: draft.pageDate,
      fallbackDate: draft.fallbackDate,
      picked: !!draft.picked,
      continues: draft.continues || null,
      dateSource: draft.picked ? 'picked' : (draft.pageDate ? 'page' : (draft.continues ? 'continues' : 'fallback')),
      month: month,
      page: draft.page || 1,
      pages: (draft.pages || []).slice(),
      paperText: draft.paperNumber ? String(draft.paperNumber) : '',
      paperRead: draft.paperNumber || null,
      paperEdited: false,
      items: draft.items.map(function (line) { return fromLine(line, draft.kind, month); })
    };
  }

  /** The notebook page number field read as a number: { value: null } for an empty field, { value: n } for 1 to 9999, { invalid: true } for anything else. */
  function paperNumberOf(state) {
    var text = String(state.paperText || '').trim();
    if (text === '') return { value: null, invalid: false };
    var number = /^\d{1,4}$/.test(text) ? Number(text) : 0;
    return number >= 1 && number <= 9999 ? { value: number, invalid: false } : { value: null, invalid: true };
  }

  /** Sets what the person typed in the notebook page field. From then on the number is theirs, not the one read from the photo. */
  function setPaperText(state, text) {
    state.paperText = text;
    state.paperEdited = true;
  }

  /** True while the field still holds the number the OCR read from the photo (so the "read from the photo" hint is shown). */
  function paperFromPhoto(state) {
    return !state.paperEdited && state.paperRead !== null && state.paperText === String(state.paperRead);
  }

  /** The most pages one day may have (the server's limit). */
  var MAX_PAGE = 20;

  /** The page choices of a daily review: pages 1 to 3, every page the day has paper for, the next new one and the chosen page, unique and sorted. */
  function pageOptions(state) {
    var last = state.pages.length ? state.pages[state.pages.length - 1] + 1 : 0;
    var all = [1, 2, 3, last, state.page].concat(state.pages).filter(function (page) { return page >= 1 && page <= MAX_PAGE; });
    return all.filter(function (page, at) { return all.indexOf(page) === at; })
      .sort(function (a, b) { return a - b; }).map(function (page) { return { page: page }; });
  }

  /** Sets the physical page the photo shows. */
  function setPage(state, page) {
    state.page = page;
  }

  /** Puts a re-read draft (after a kind switch) into the same state object, so the open review keeps its handle.
   * The notebook page number stays as it is, and so does a day the person picked in the review. */
  function replaceDraft(state, draft) {
    var number = { paperText: state.paperText, paperRead: state.paperRead, paperEdited: state.paperEdited };
    var mine = state.dateSource === 'picked' ? { date: state.date, dateSource: 'picked' } : null;
    Object.assign(state, fromDraft(draft), number, mine || {});
  }

  /** True when the kind files lines on days of the log (events are allowed there). */
  function allowsEvent(kind) {
    return kind === 'daily' || kind === 'calendar';
  }

  /** Sets the day. The note under it says where it came from: the page, the day it continues, the fallback, or the person. The page number is kept (the check then says which pages the new day has). */
  function setDate(state, date) {
    state.date = date;
    if (state.picked && date === state.fallbackDate) state.dateSource = 'picked';
    else if (date === state.pageDate) state.dateSource = 'page';
    else if (!state.pageDate && state.continues && date === state.continues) state.dateSource = 'continues';
    else if (!state.pageDate && date === state.fallbackDate) state.dateSource = 'fallback';
    else state.dateSource = 'picked';
  }

  /** Sets the month of a calendar or month-task page. */
  function setMonth(state, month) {
    state.month = month;
    state.items.forEach(function (item) { item.pageMonth = month; });
  }

  /** A calendar line's day as a whole number 1 to 31, else null. */
  function dayOf(item) {
    var text = String(item.dayText || '').trim();
    if (!/^\d{1,2}$/.test(text)) return null;
    var day = Number(text);
    return day >= 1 && day <= 31 ? day : null;
  }

  /** Takes the server's answer for a day. A line the person ticked or unticked by hand keeps their choice, except an unchanged one. The pages follow the day. */
  function mergeChecks(state, answer) {
    if (answer.pages) state.pages = answer.pages.slice();
    answer.items.forEach(function (check) {
      var item = state.items.filter(function (candidate) { return candidate.id === check.id; })[0];
      if (!item) return;
      item.status = check.status;
      item.target = check.target;
      item.before = check.before;
      item.after = check.after;
      item.contested = check.contested;
      item.moveTo = check.moveTo || null;
      item.traced = check.traced === true;
      item.movedFrom = check.movedFrom || null;
      item.offPaper = check.offPaper === true;
      if (item.status === 'unchanged') {
        item.include = false;
        item.touched = false;
      } else if (!item.touched) {
        item.include = defaultInclude(item);
      }
    });
  }

  /** What a line is matched to: { kind: 'entry', title }, { kind: 'trace' }, { kind: 'moved', date } or null. An un-matched line is matched to nothing. */
  function matchOf(item) {
    if (item.unmatched) return null;
    if (item.movedFrom) return { kind: 'moved', title: '', date: item.movedFrom.date };
    if (item.target && item.status !== 'new') return { kind: 'entry', title: item.target.title };
    return item.traced ? { kind: 'trace', title: '' } : null;
  }

  /** The copy key of what applying does to the matched item: 'same' (only marked on paper), a new type, or 'fields' for a title, tag or time. */
  function changeKey(item) {
    if (item.status !== 'edited' || !item.before || !item.after) return 'same';
    return item.after.type !== item.before.type ? item.after.type : 'fields';
  }

  /** Turns a matched line into a new one: the person says it is not the item it matched. The server is asked again for the rest. */
  function unmatch(item) {
    var match = matchOf(item);
    if (!match) return;
    item.wasMatch = match;
    item.unmatched = true;
    item.status = 'new';
    item.target = null;
    item.before = null;
    item.after = null;
    item.contested = false;
    item.moveTo = null;
    item.traced = false;
    item.movedFrom = null;
    item.offPaper = false;
    item.touched = false;
    item.include = defaultInclude(item);
  }

  /** Lets a line match again. The next check says what it matches. */
  function rematch(item) {
    item.unmatched = false;
    item.touched = false;
  }

  /** The lines that will be written: kept, and new or edited. An unchanged line writes nothing. */
  function keptItems(state) {
    return state.items.filter(function (item) { return item.include && item.status !== 'unchanged'; });
  }

  /** How many kept lines add an entry, how many change one, and how many matched entries move to the paper's place. */
  function counts(state) {
    var kept = keptItems(state);
    var updated = kept.filter(function (item) { return item.status === 'edited' || !!item.movedFrom; }).length;
    var moved = state.items.filter(function (item) { return item.moveTo && !item.unmatched; }).length;
    var confirmed = state.items.filter(function (item) { return item.status === 'unchanged' && item.offPaper && !item.unmatched; }).length;
    return { created: kept.length - updated, updated: updated, moved: moved, confirmed: confirmed };
  }

  /** True when a calendar day exists in the month of the page (no 30 February). */
  function dayFits(state, day) {
    return day !== null && day <= Number(L.horizon.model.lastDay(state.month).slice(8));
  }

  /** The kept calendar line with no usable day (none typed, or one the month does not have), or undefined. */
  function dayProblemItem(state, kept) {
    if (state.kind !== 'calendar') return undefined;
    return kept.filter(function (item) { return !dayFits(state, dayOf(item)); })[0];
  }

  /** The first kept line that cannot be filed for the kind, as a key: 'day' (calendar), 'month' (future), else ''. */
  function placeProblem(state, kept) {
    if (dayProblemItem(state, kept)) return 'day';
    if (state.kind === 'future' && kept.some(function (item) { return !item.month; })) return 'month';
    return '';
  }

  /** The kept line a 'day' problem is about: { title, day } where day is the typed text (empty when none), so the alert can name it. Null when no line lacks a day. */
  function dayProblemOf(state) {
    var item = dayProblemItem(state, keptItems(state));
    return item ? { title: item.title.trim(), day: String(item.dayText || '').trim() } : null;
  }

  /** Sets what the person typed in a row's day field. A line the person has not ticked by hand follows the day: it is kept once it has a day, and not before. */
  function setDayText(item, text) {
    item.dayText = text;
    if (!item.touched) item.include = defaultInclude(item);
  }

  /** 'paper' when the notebook page field is not a number from 1 to 9999, 'title' when a kept line has no title, 'day' or 'month' when a kept line has no place, 'none' when nothing is kept, else ''. */
  function problem(state) {
    if (paperNumberOf(state).invalid) return 'paper';
    var kept = keptItems(state);
    if (kept.some(function (item) { return item.title.trim() === ''; })) return 'title';
    var place = placeProblem(state, kept);
    if (place) return place;
    return kept.length || counts(state).moved || counts(state).confirmed ? '' : 'none';
  }

  function isLowConfidence(item) {
    return item.confidence < LOW_CONFIDENCE;
  }

  function percent(item) {
    return Math.round(item.confidence * 100);
  }

  /** The tags a row holds: the ones read from the page. The review has no tag field, so they pass through unchanged. */
  function tagsOf(item) {
    return item.tags.slice();
  }

  /**
   * The marker state of a row: 'skipped' (a changing line that is not kept), 'matched' (unchanged on paper), 'new' (will create an entry),
   * 'updated' (an existing entry gets changed text or status). typeChanged is true for an updated line whose type differs from the entry's.
   */
  function markerOf(item) {
    if (item.status === 'unchanged') return { state: 'matched', typeChanged: false };
    if (!item.include) return { state: 'skipped', typeChanged: false };
    var updated = item.status === 'edited' || !!item.movedFrom;
    var typeChanged = updated && !!item.before && !!item.after && item.before.type !== item.after.type;
    return { state: updated ? 'updated' : 'new', typeChanged: typeChanged };
  }

  /** One line as the server reads it. A calendar line carries its day and a future line its month. An un-matched line says so. */
  function lineBody(state, item) {
    var body = { id: item.id, type: item.type, title: item.title.trim(), tags: tagsOf(item), time: item.time };
    if (state.kind === 'calendar') body.day = dayOf(item);
    if (state.kind === 'future') body.month = item.month;
    if (item.unmatched) body.unmatched = true;
    if (indentOf(state, item) === 1) body.indent = 1;
    if (item.important) body.important = true;
    return body;
  }

  /** The page-level fields of a request: the kind, plus the day and physical page (daily) or the month (calendar, month tasks). */
  function pageBody(state) {
    var body = { kind: state.kind };
    if (state.kind === 'daily') {
      body.date = state.date;
      body.page = state.page;
    }
    if (NEEDS_MONTH[state.kind]) body.month = state.month;
    var number = paperNumberOf(state).value;
    if (number !== null) body.paperNumber = number;
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

  /** Where the person should land after an apply: the Daily view on the day, the Future view, or the Month view on the page's month
   * (a month-task page on its tasks page, a calendar on its calendar page). paperNumber is the notebook page the apply stored (or null). */
  function landing(state, result) {
    var place = landingPlace(state, result);
    place.paperNumber = paperNumberOf(state).value;
    return place;
  }

  /** The view part of a landing. */
  function landingPlace(state, result) {
    if (state.kind === 'daily') return { view: 'daily', date: result.date || state.date };
    if (state.kind === 'future') return { view: 'future', month: null };
    return { view: 'month', month: state.month, part: state.kind === 'calendar' ? 'calendar' : 'tasks' };
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

  /** What the "was" row shows of an edited line: the old type and title, plus the old time when the paper writes a different one. */
  function changedFields(item) {
    var before = item.before;
    if (item.status !== 'edited' || !before) return null;
    return {
      type: before.type,
      title: before.title,
      time: item.time && before.time !== item.time ? { value: before.time } : null
    };
  }

  L.scan.model = {
    photoProblem: photoProblem,
    uploadable: uploadable,
    defaultInclude: defaultInclude,
    isPast: isPast,
    setClock: setClock,
    fromDraft: fromDraft,
    replaceDraft: replaceDraft,
    allowsEvent: allowsEvent,
    setDate: setDate,
    setMonth: setMonth,
    pageOptions: pageOptions,
    setPage: setPage,
    paperNumberOf: paperNumberOf,
    setPaperText: setPaperText,
    paperFromPhoto: paperFromPhoto,
    dayOf: dayOf,
    setDayText: setDayText,
    dayProblemOf: dayProblemOf,
    mergeChecks: mergeChecks,
    matchOf: matchOf,
    changeKey: changeKey,
    unmatch: unmatch,
    markerOf: markerOf,
    indentOf: indentOf,
    rematch: rematch,
    keptItems: keptItems,
    counts: counts,
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
