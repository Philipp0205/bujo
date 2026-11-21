/*
 * The word being typed in the title, for the autocomplete. Pure: no DOM, no fetch.
 *
 * at(text, caret) finds the "#tag" or "@date" word that ends at the caret: { kind: 'tag' | 'date', query, start, end }, or null
 * when the caret is not at the end of such a word. query is the text after the # or @. Both words start the text or follow a space.
 * apply(text, token, insert) swaps that word for `insert` plus a space (the space after the caret is reused when there is one)
 * and answers { text, caret } with the caret after the space.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.suggest = L.suggest || {};

  var TAG_CHARS = /^[\p{L}\p{N}_-]*$/u;
  var DATE_CHARS = /^[\p{L}\p{N}.]*$/u;

  /** The start of the word the caret ends: the index after the last whitespace before it. */
  function wordStart(text, caret) {
    var start = caret;
    while (start > 0 && !/\s/.test(text.charAt(start - 1))) start--;
    return start;
  }

  /** The growing # or @ word that ends at the caret, or null. */
  function at(text, caret) {
    if (caret < 1 || caret > text.length) return null;
    if (caret < text.length && !/\s/.test(text.charAt(caret))) return null;
    var start = wordStart(text, caret);
    var word = text.slice(start, caret);
    var mark = word.charAt(0);
    var query = word.slice(1);
    if (mark === '#' && TAG_CHARS.test(query)) return { kind: 'tag', query: query, start: start, end: caret };
    if (mark === '@' && DATE_CHARS.test(query)) return { kind: 'date', query: query, start: start, end: caret };
    return null;
  }

  /** The text with the word replaced by `insert` and one space, and where the caret goes. */
  function apply(text, token, insert) {
    var rest = text.slice(token.end);
    var spaced = /^\s/.test(rest) ? rest.slice(1) : rest;
    var head = text.slice(0, token.start) + insert + ' ';
    return { text: head + spaced, caret: head.length };
  }

  L.suggest.token = { at: at, apply: apply };
})();
