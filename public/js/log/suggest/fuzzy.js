/*
 * Fuzzy ranking of tags for the autocomplete. Pure: no DOM, no fetch, no strings to show.
 *
 * Text is folded before it is compared: lower case, ß as ss, accents dropped, and ae/oe/ue read as a/o/u, so "kuche",
 * "kueche" and "Küche" are one word, and so are "kaese" and "Käse". A tag then matches a query in one of these tiers:
 *   0 exact   1 starts with the query   2 a word of the tag (after - or _) starts with it   3 contains it
 *   4 holds the query's letters in order (only for a query of 2 or more letters)
 * rank() sorts by tier first, then by last use (newest first), then by how often it is used, then by name.
 * An empty query keeps every tag and sorts by last use alone.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.suggest = L.suggest || {};

  /** The comparison form of a text. */
  function fold(text) {
    return String(text).toLowerCase().replace(/\u00df/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
  }

  /** True when every letter of the query appears in the text, in the same order. */
  function inOrder(query, text) {
    var at = 0;
    for (var i = 0; i < text.length && at < query.length; i++) if (text.charAt(i) === query.charAt(at)) at++;
    return at === query.length;
  }

  /** True when a word of the text, after a - or _, starts with the query. */
  function startsWord(query, text) {
    return text.split(/[-_]/).slice(1).some(function (word) { return word.indexOf(query) === 0; });
  }

  /** The tier of a folded tag for a folded query (0 is best), or -1 when it does not match. */
  function tier(query, text) {
    if (text === query) return 0;
    if (text.indexOf(query) === 0) return 1;
    if (startsWord(query, text)) return 2;
    if (text.indexOf(query) >= 0) return 3;
    return query.length >= 2 && inOrder(query, text) ? 4 : -1;
  }

  function byUse(a, b) {
    return (b.item.lastUsed || 0) - (a.item.lastUsed || 0) || (b.item.count || 0) - (a.item.count || 0) || a.item.tag.localeCompare(b.item.tag);
  }

  /** The pool items that match the query, best first, at most `limit` of them. Items are { tag, count, lastUsed }. */
  function rank(query, pool, limit) {
    var wanted = fold(query.trim());
    var scored = [];
    pool.forEach(function (item) {
      var found = wanted === '' ? 0 : tier(wanted, fold(item.tag));
      if (found >= 0) scored.push({ item: item, tier: found });
    });
    scored.sort(function (a, b) { return a.tier - b.tier || byUse(a, b); });
    return scored.slice(0, limit || scored.length).map(function (one) { return one.item; });
  }

  L.suggest.fuzzy = { fold: fold, rank: rank };
})();
