/*
 * Written tags and times in an entry line: the browser twin of src/log/markup.ts. Keep the two in lockstep
 * (test/log-markup.test.ts runs both over one corpus). Pure: no DOM, no fetch, no strings to show.
 *
 * BujoLog.markup.parse(text, { final }) returns { title, tag, time }.
 * A token is a whitespace separated word. "#tag" sets the tag (the last one wins), "9:00", "14:30", "14h" and "9h30"
 * set the time as HH:MM (the last one wins). Both are cut out of the title. Anything glued to a word is plain text.
 * With final false (the person is typing) a token at the very end of the text may still be growing, so it is left alone.
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

  /**
   * Reads the written tag and time of a line and returns the line without them.
   * A final parse that would leave no title at all keeps the text as it is and finds nothing.
   */
  function parse(text, options) {
    var final = !!(options && options.final === true);
    var split = pieces(text);
    var tag = null;
    var time = null;
    split.list.forEach(function (piece, index) {
      var growing = !final && index === split.list.length - 1 && split.tail === '';
      if (growing) return;
      var written = tagOf(piece.word);
      var clock = written === null ? timeOf(piece.word) : null;
      if (written === null && clock === null) return;
      piece.cut = true;
      if (written !== null) tag = written;
      else time = clock;
    });
    if (tag === null && time === null) return { title: final ? text.trim() : text, tag: tag, time: time };
    var title = assemble(split.list, split.tail);
    if (final && title.trim() === '') return { title: text.trim(), tag: null, time: null };
    return { title: final ? title.trim() : title, tag: tag, time: time };
  }

  L.markup = { parse: parse };
})();
