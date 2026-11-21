/*
 * Pure model of the line being typed in the rapid log: its values, and the fields to send. No DOM, no fetch, no strings.
 * A line is a new entry (id null) or an existing one being renamed in place. Needs nothing.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var FIELDS = ['date', 'type', 'title', 'tags', 'time'];

  /** An empty new line: a task on the given day, with no tags or time, not nested. */
  function blank(date) {
    return { id: null, isNew: true, home: date, date: date, type: 'task', title: '', tags: [], time: null, indent: 0, edited: false, original: null, error: '', saving: null };
  }

  /** A line that edits a saved entry. home is the day group it sits in until it is saved. */
  function fromEntry(entry) {
    return {
      id: entry.id,
      isNew: false,
      home: entry.date,
      date: entry.date,
      type: entry.type,
      title: entry.title,
      tags: (entry.tags || []).slice(),
      time: entry.time || null,
      indent: entry.indent || 0,
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

  /**
   * Moves written #tags, a day and a time out of the text into the line. opts: final is true when the text is done (save),
   * false while it is being typed; today (YYYY-MM-DD) is the day "@morgen" counts from; known is the pool [{ tag }] whose spelling
   * a written tag takes. Returns true when the text changed, so the input must show the cleaned title.
   */
  function absorb(line, text, opts) {
    var found = L.markup.parse(text, { final: opts.final, today: opts.today });
    mergeTags(line, found.tags, opts.known);
    if (found.date !== null) {
      if (found.date !== line.date) line.indent = 0;
      line.date = found.date;
    }
    if (found.time !== null) line.time = found.time;
    line.title = found.title;
    return found.title !== text;
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

  /** All the fields of a line, as the API wants them. An empty tag list or a null time clears it on an edit. */
  function values(line) {
    return { date: line.date, type: line.type, title: line.title.trim(), tags: line.tags.slice(), time: line.time };
  }

  /** True when a field is the same as the saved one. Tags compare as lists in order, the rest as values. */
  function unchanged(key, before, next) {
    return key === 'tags' ? JSON.stringify(before || []) === JSON.stringify(next) : before === next;
  }

  /** The fields to send: everything for a new line, only what differs from the saved entry for an edit. */
  function changes(line) {
    var next = values(line);
    if (line.isNew) return next;
    var out = {};
    FIELDS.forEach(function (key) {
      var before = line.original[key] === undefined ? null : line.original[key];
      if (!unchanged(key, before, next[key])) out[key] = next[key];
    });
    return out;
  }

  L.inline.model = {
    blank: blank, fromEntry: fromEntry, hasTitle: hasTitle, absorb: absorb, settle: settle,
    toggleTag: toggleTag, tagsFull: tagsFull, changes: changes
  };
})();
