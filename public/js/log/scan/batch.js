/*
 * Pure rules of a multi-page scan: how many pages one batch may hold, which page is next to review, which notebook numbers the
 * pages of a batch carry (so the gap reminder weighs them together) and where the batch lands. No DOM, no fetch, no strings.
 * A page is { status, state, type, landing }: status is 'pending', 'applied', 'saved', 'skipped' or 'failed'.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var MAX_PAGES = 10;
  var SETTLED = ['applied', 'saved', 'skipped'];

  /** True when more pages were picked than one batch may hold. */
  function exceeds(count) {
    return count > MAX_PAGES;
  }

  /** True once a page needs nothing more from the person: it was applied, saved or skipped. */
  function settled(page) {
    return SETTLED.indexOf(page.status) >= 0;
  }

  /** True when every page of the batch is settled. */
  function allSettled(pages) {
    return pages.every(settled);
  }

  /** The index of the first page with `status` after `from`, wrapping round the batch; -1 when none. */
  function findAfter(pages, from, status) {
    for (var step = 1; step <= pages.length; step += 1) {
      var index = (from + step) % pages.length;
      if (pages[index].status === status) return index;
    }
    return -1;
  }

  /** The page to open after `from` is done: the next one still to review, else a failed one to retry or skip, else -1 (the batch is done). */
  function nextOpen(pages, from) {
    var pending = findAfter(pages, from, 'pending');
    return pending >= 0 ? pending : findAfter(pages, from, 'failed');
  }

  /** The notebook numbers the log pages of the batch carry, other than `except`'s: pages still to review or already applied count, skipped, failed and note pages do not. */
  function numbers(pages, except) {
    var found = [];
    pages.forEach(function (page) {
      if (page === except || !page.state || page.type !== 'log') return;
      if (page.status !== 'pending' && page.status !== 'applied') return;
      var number = L.scan.model.paperNumberOf(page.state).value;
      if (number !== null) found.push(number);
    });
    return found;
  }

  /** Where the batch lands: the place of the last page that was applied or saved, with the highest notebook number of the applied pages,
   * so the gap reminder (which looks at one number) sees the whole batch at once. */
  function landing(last, pages) {
    var highest = numbers(pages.filter(function (page) { return page.status === 'applied'; }), null);
    var place = Object.assign({}, last);
    if (highest.length) place.paperNumber = Math.max.apply(null, highest);
    return place;
  }

  /** The pages waiting for Done: `files` joined to `pending`, cut at MAX_PAGES. `full` tells that some did not fit. */
  function collect(pending, files) {
    var room = Math.max(MAX_PAGES - pending.length, 0);
    return { pending: pending.concat(files.slice(0, room)), full: files.length > room };
  }

  /** True when no more pages fit in the pending batch. */
  function isFull(pending) {
    return pending.length >= MAX_PAGES;
  }

  /** The pending pages without the one at `index`. */
  function without(pending, index) {
    return pending.filter(function (_, at) { return at !== index; });
  }

  L.scan.batch = {
    MAX_PAGES: MAX_PAGES, exceeds: exceeds, settled: settled, allSettled: allSettled, nextOpen: nextOpen, numbers: numbers, landing: landing,
    collect: collect, isFull: isFull, without: without
  };
})();
