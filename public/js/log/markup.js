/*
 * Written tags, dates and times in an entry line: the browser twin of src/log/markup.ts. Keep the two in lockstep
 * (test/log-markup.test.ts runs both over one corpus). Pure: no DOM, no fetch, no strings to show. Needs date-token.js.
 *
 * BujoLog.markup.parse(text, { final, today, dates }) returns { title, tags, date, month, time }.
 * A token is a whitespace separated word.
 *   "#tag"            adds a tag. Every tag is kept, in the order written; a repeat that differs only in case is dropped.
 *   "@morgen", "@23.11." and the other date words of date-token.js set the day (the last one wins).
 *   "@dez", "@december" and "@12.2026" set a whole month (YYYY-MM) instead (the last day or month word wins).
 *   "9:00", "14:30", "14h" and "9h30" set the time as HH:MM (the last one wins).
 * All of them are cut out of the title. Anything glued to a word is plain text.
 * With final false (the person is typing) a token at the very end of the text may still be growing, so it is left alone.
 * `today` (YYYY-MM-DD) defaults to the local day. `dates` false leaves "@..." words in the title.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  var TAG_MAX = 40;
  var TAG_WORD = /^#([\p{L}\p{N}_-]+)$/u;
  var HAS_LETTER = /\p{L}/u;
  var CLOCK_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  /** "14h": two digits, so a duration like "5h" stays text. */
  var HOUR_ONLY = /^([01]\d|2[0-3])[hH]$/;
  /** "9h30" or "14h30". */
  var HOUR_MINUTES = /^([01]?\d|2[0-3])[hH]([0-5]\d)$/;

  /** The tag a word writes, or null. At least one letter (so "#1" stays text) and within the tag length cap. */
  function tagOf(word) {
    var match = TAG_WORD.exec(word);
    if (!match || match[1].length > TAG_MAX || !HAS_LETTER.test(match[1])) return null;
    return match[1];
  }

  /** The time a word writes as HH:MM, or null. */
  function timeOf(word) {
    var match = CLOCK_TIME.exec(word) || HOUR_MINUTES.exec(word) || HOUR_ONLY.exec(word);
    if (!match) return null;
    return (match[1].length < 2 ? '0' : '') + match[1] + ':' + (match[2] || '00');
  }

  /** Today as YYYY-MM-DD on this machine's clock. */
  function localToday() {
    var now = new Date();
    function pad(value) { return (value < 10 ? '0' : '') + value; }
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  /** Splits the text into words, each with the whitespace in front of it, and the whitespace after the last one. */
  function pieces(text) {
    var list = [];
    var at = 0;
    var re = /\S+/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      list.push({ gap: text.slice(at, match.index), word: match[0], cut: false });
      at = match.index + match[0].length;
    }
    return { list: list, tail: text.slice(at) };
  }

  /** Puts the kept words back together. The gap before a cut word goes with it, so no double space is left. */
  function assemble(list, tail) {
    var out = '';
    var cutBefore = false;
    list.forEach(function (piece) {
      if (piece.cut) { cutBefore = true; return; }
      out += out === '' && cutBefore ? piece.word : piece.gap + piece.word;
    });
    return out === '' ? '' : out + tail;
  }

  /** Adds a tag unless the list has it already, ignoring case (the first spelling stays). */
  function addTag(tags, tag) {
    var key = tag.toLowerCase();
    var have = tags.some(function (one) { return one.toLowerCase() === key; });
    if (!have) tags.push(tag);
  }

  /**
   * Reads the written tags, day and time of a line and returns the line without them.
   * A final parse that would leave no title at all keeps the text as it is and finds nothing.
   */
  function parse(text, options) {
    var opts = options || {};
    var final = opts.final === true;
    var today = opts.today || localToday();
    var split = pieces(text);
    var found = { title: text, tags: [], date: null, month: null, time: null };
    split.list.forEach(function (piece, index) {
      var growing = !final && index === split.list.length - 1 && split.tail === '';
      if (growing) return;
      var tag = tagOf(piece.word);
      var dated = tag === null && opts.dates !== false;
      var day = dated ? L.dateToken.of(piece.word, today) : null;
      var month = dated && day === null ? L.dateToken.monthOf(piece.word, today) : null;
      var clock = tag === null && day === null && month === null ? timeOf(piece.word) : null;
      if (tag === null && day === null && month === null && clock === null) return;
      piece.cut = true;
      if (tag !== null) addTag(found.tags, tag);
      else if (day !== null) { found.date = day; found.month = null; }
      else if (month !== null) { found.date = null; found.month = month; }
      else found.time = clock;
    });
    var anyCut = split.list.some(function (piece) { return piece.cut; });
    if (!anyCut) return { title: final ? text.trim() : text, tags: found.tags, date: null, month: null, time: null };
    var title = assemble(split.list, split.tail);
    if (final && title.trim() === '') return { title: text.trim(), tags: [], date: null, month: null, time: null };
    return { title: final ? title.trim() : title, tags: found.tags, date: found.date, month: found.month, time: found.time };
  }

  L.markup = { parse: parse };
})();
