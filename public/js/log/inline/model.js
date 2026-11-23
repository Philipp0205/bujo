/*
 * Pure model of the line being typed in the rapid log: its values, and the fields to send. No DOM, no fetch, no strings.
 * A line is a new entry (id null) or an existing one being renamed in place. Needs nothing.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var FIELDS = ['date', 'type', 'title', 'tags', 'time', 'horizon'];

  /** An empty new line in a slot ({ date, horizon }): a task with no tags or time, not nested. The slot is its home group. */
  function blank(slot) {
    return {
      id: null, isNew: true, home: slot.date, homeHorizon: slot.horizon, date: slot.date, horizon: slot.horizon, type: 'task',
      title: '', tags: [], time: null, indent: 0, trace: null, edited: false, original: null, error: '', saving: null
    };
  }

  /** A line that edits a saved entry. home and homeHorizon are the group it sits in until it is saved. */
  function fromEntry(entry) {
    var horizon = entry.horizon || 'day';
    return {
      id: entry.id,
      isNew: false,
      home: entry.date,
      homeHorizon: horizon,
      date: entry.date,
      horizon: horizon,
      type: entry.type,
      title: entry.title,
      tags: (entry.tags || []).slice(),
      time: entry.time || null,
      indent: entry.indent || 0,
      trace: null,
      edited: false,
      original: entry,
      error: '',
      saving: null
    };
  }

  /** True when the title has something other than spaces. */
  function hasTitle(line) {
    return line.title.trim() !== '';
  }

  /** Adds written tags to the line: new ones only (the line's own spelling wins), in the pool's spelling, up to the cap. */
  function mergeTags(line, written, known) {
    written.forEach(function (tag) {
      line.tags = L.tags.add(line.tags, L.tags.spell(tag, known || []));
    });
  }

  /** Files the line under a day: its horizon is day (the daily log). A move to another group takes the line out of any nesting. */
  function setDay(line, date) {
    if (date !== line.date || line.horizon !== 'day') line.indent = 0;
    line.date = date;
    line.horizon = 'day';
  }

  /** The last day of a month (YYYY-MM). A month item is dated by it, so it sorts after every day of its month. */
  function lastDay(month) {
    return L.dates.monthEnd(month + '-01', 0);
  }

  /** Files the line under a whole month: a month-task for this month (or an earlier one), a future item for a later month. */
  function setMonth(line, month, today) {
    var horizon = month <= today.slice(0, 7) ? 'month-task' : 'future';
    var date = lastDay(month);
    if (date !== line.date || horizon !== line.horizon) line.indent = 0;
    line.date = date;
    line.horizon = horizon;
  }

  /**
   * Moves written #tags, a day, a month and a time out of the text into the line. opts: final is true when the text is done (save),
   * false while it is being typed; today (YYYY-MM-DD) is the day "@morgen" counts from; known is the pool [{ tag }] whose spelling
   * a written tag takes. Returns true when the text changed, so the input must show the cleaned title.
   */
  function absorb(line, text, opts) {
    var found = L.markup.parse(text, { final: opts.final, today: opts.today });
    mergeTags(line, found.tags, opts.known);
    if (found.date !== null) setDay(line, found.date);
    else if (found.month !== null) setMonth(line, found.month, opts.today);
    if (found.time !== null) line.time = found.time;
    line.title = found.title;
    return found.title !== text;
  }

  /** A day chosen on the Date key: the line becomes a day entry on it. */
  function chooseDay(line, date) {
    setDay(line, date);
  }

  /** Reads the markup of a line that was typed in: a new line, or a saved one whose title was edited. Untouched titles stay as saved. */
  function settle(line, opts) {
    if (line.isNew || line.edited) absorb(line, line.title, { final: true, today: opts.today, known: opts.known });
  }

  /** Puts a tag on the line, or takes it off when it is there. Returns false when the line is full. */
  function toggleTag(line, tag) {
    if (L.tags.has(line.tags, tag)) { line.tags = L.tags.remove(line.tags, tag); return true; }
    var next = L.tags.add(line.tags, tag);
    if (next === line.tags) return false;
    line.tags = next;
    return true;
  }

  /** True when the line holds as many tags as an entry may. */
  function tagsFull(line) {
    return line.tags.length >= L.tags.TAGS_MAX;
  }

  /** All the fields of a line, as the API wants them. An empty tag list or a null time clears it on an edit. An event needs a real day, so a month-task or future line is a task. */
  function values(line) {
    var type = line.type === 'event' && !L.days.hasDay(line.horizon) ? 'task' : line.type;
    return { date: line.date, horizon: line.horizon, type: type, title: line.title.trim(), tags: line.tags.slice(), time: line.time };
  }

  /** True when a field is the same as the saved one. Tags compare as lists in order, the rest as values. */
  function unchanged(key, before, next) {
    return key === 'tags' ? JSON.stringify(before || []) === JSON.stringify(next) : before === next;
  }

  /** The saved value of a field of a line's entry. An entry from before horizons existed is a day entry. */
  function savedValue(line, key) {
    if (key === 'horizon') return line.original.horizon || 'day';
    return line.original[key] === undefined ? null : line.original[key];
  }

  /** The fields to send: everything for a new line, only what differs from the saved entry for an edit. A move that asked for a trace says which. */
  function changes(line) {
    var next = values(line);
    if (line.isNew) return next;
    var out = {};
    FIELDS.forEach(function (key) {
      if (!unchanged(key, savedValue(line, key), next[key])) out[key] = next[key];
    });
    if (line.trace && moved(line)) out.trace = line.trace;
    return out;
  }

  /** True when the line is no longer in the group it started in (a new day or month was written or picked). */
  function moved(line) {
    return line.date !== line.home || line.horizon !== line.homeHorizon;
  }

  L.inline.model = {
    blank: blank, fromEntry: fromEntry, hasTitle: hasTitle, absorb: absorb, settle: settle, chooseDay: chooseDay, moved: moved,
    toggleTag: toggleTag, tagsFull: tagsFull, changes: changes
  };
})();
