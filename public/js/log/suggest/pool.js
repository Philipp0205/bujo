/*
 * The tags the person already uses, for the autocomplete: what the server lists (GET /api/tags) merged with the tags on screen.
 * Case-insensitive: one spelling per tag, the first one seen wins (the server's, so a tag keeps the spelling it was made with).
 * Holds one list in memory and never blocks: a failed or slow fetch just leaves the pool smaller. Needs api.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.suggest = L.suggest || {};

  var known = [];

  /** Reads the server's list again. Never rejects: the autocomplete works with what it has. */
  function refresh() {
    return L.api.listTags().then(function (list) { known = list; }, function () {});
  }

  /** The tags of the entries on screen as pool items (no count or last use, so they rank after the server's). */
  function fromEntries(entries) {
    var out = [];
    entries.forEach(function (entry) {
      (entry.tags || []).forEach(function (tag) { out.push({ tag: tag, count: 0, lastUsed: 0 }); });
    });
    return out;
  }

  /** The merged pool: the server's tags, then tags only seen on screen. entries are the ones the page shows. */
  function items(entries) {
    var merged = [];
    var seen = {};
    known.concat(fromEntries(entries || [])).forEach(function (item) {
      var key = item.tag.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      merged.push(item);
    });
    return merged;
  }

  L.suggest.pool = { refresh: refresh, items: items };
})();
