/*
 * The page data of the three tabs, stale while revalidate (AppKit.swr, ak-swr.js). A tab that was never shown paints the last
 * list at once from the cache, so there is no loading note on a revisit; the fresh list replaces it only when it changed.
 * A tab that is on screen already keeps what it shows and refreshes quietly. A missing or blocked localStorage just means no cache.
 *
 *   BujoNav.data.load(key, fetcher, { stale, fresh, fail })  stale(value) only when a cached value is drawn (leave it out to skip
 *                                                            the cache), fresh(value) with the server's value, fail(error) when
 *                                                            the fetch failed (even when a cached value was drawn).
 *   BujoNav.data.warm(key, fetcher)                          fills the cache for a tab that is not shown yet. Never throws.
 *   BujoNav.data.fresh(key, fetcher)                         reads the server alone (no shared read), then updates the cache.
 *   BujoNav.data.clear()                                     forgets every cached list (sign out).
 * Needs ak-swr.js.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};

  var KEYS = { log: 'bujo-log-entries', logAhead: 'bujo-log-ahead', notes: 'bujo-notes', settings: 'bujo-settings' };

  /** Reads through the cache: stale() for a cached value, then fresh() or fail() for the fetch. Resolves when that is done. */
  function load(key, fetcher, hooks) {
    var failure = null;
    var drawn = function (value, info) {
      if (info.stale && hooks.stale) hooks.stale(value);
    };
    var read = AppKit.swr(key, fetcher, drawn, { onError: function (error) { failure = error; } });
    return read.then(function (value) {
      if (failure) hooks.fail(failure);
      else hooks.fresh(value);
    }, hooks.fail);
  }

  /** Fetches a list into the cache so the tab's first show can paint from it. */
  function warm(key, fetcher) {
    return AppKit.swr(key, fetcher, function () { /* only the cache is wanted */ }).then(null, function () { /* the tab tries again */ });
  }

  /** Writes a list into the cache in the format AppKit.swr reads (documented in ak-swr.js). A blocked storage means no cache. */
  function remember(key, value) {
    try { window.localStorage.setItem('ak-swr:' + key, JSON.stringify({ t: Date.now(), v: value })); } catch (ignored) { /* no cache */ }
  }

  /** A read that never joins another one (after a save, the list must include the save), and keeps the cache current. */
  function fresh(key, fetcher) {
    return fetcher().then(function (value) {
      remember(key, value);
      return value;
    });
  }

  function clear() {
    if (AppKit.swr) AppKit.swr.clear();
  }

  N.data = { KEYS: KEYS, load: load, warm: warm, fresh: fresh, clear: clear };
})();
