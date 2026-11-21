/*
 * What the suggestion strip offers for the word at the caret. Pure: no DOM, no fetch. Needs fuzzy.js, dates.js (suggest),
 * tags.js and copy.js.
 *
 * optionsFor(token, line, pool, today) answers a list of { kind, label, hint, insert, value }:
 *   kind 'tag'   an existing tag, label "#name", insert "#name" (its own spelling). Tags the line has already are left out.
 *   kind 'new'   "use #typed" for a valid word that is no tag yet, always last
 *   kind 'date'  a day, label "Mo 23.11.", hint "morgen", insert "@23.11." (see dates.js)
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.suggest = L.suggest || {};

  var LIMIT = 6;
  var HAS_LETTER = /\p{L}/u;

  /** The pool minus the tags the line has. */
  function unused(pool, line) {
    return pool.filter(function (item) { return !L.tags.has(line.tags, item.tag); });
  }

  /** True when the typed word could become a new tag: valid, with a letter, and not in the pool yet. */
  function isNew(query, pool) {
    return L.tags.isTag(query) && HAS_LETTER.test(query) && !L.tags.has(pool.map(function (item) { return item.tag; }), query);
  }

  /** The tag suggestions for a query: the best matches, then "use #query" when it is new. */
  function tagOptions(query, line, pool) {
    var options = L.suggest.fuzzy.rank(query, unused(pool, line), LIMIT).map(function (item) {
      return { kind: 'tag', label: '#' + item.tag, hint: '', insert: '#' + item.tag, value: item.tag };
    });
    if (query !== '' && isNew(query, pool) && !L.tags.has(line.tags, query)) {
      options = options.slice(0, LIMIT - 1);
      options.push({ kind: 'new', label: L.copy.suggest.useTag('#' + query), hint: '', insert: '#' + query, value: query });
    }
    return options;
  }

  /** The date suggestions for a query, shaped like the tag ones. */
  function dateOptions(query, today) {
    return L.suggest.dates.suggest(query, today).map(function (item) {
      return { kind: 'date', label: item.label, hint: item.hint, insert: item.insert, value: item.iso };
    });
  }

  /** The options for a token ({ kind: 'tag' | 'date', query }). */
  function optionsFor(token, line, pool, today) {
    return token.kind === 'tag' ? tagOptions(token.query, line, pool) : dateOptions(token.query, today);
  }

  L.suggest.options = { optionsFor: optionsFor };
})();
