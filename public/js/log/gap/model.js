/*
 * The page-gap rules: which notebook pages lie between the highest page already known and a newly scanned one.
 * Pure functions over plain numbers (no DOM, no storage, no fetch), so the list of known numbers is passed in and the rules
 * can be scoped to a notebook later. Pages before the first known page are never asked for, because only the span above the
 * highest known page can be a gap.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.gap = L.gap || {};

  var MIN_PAGE = 1;
  var MAX_PAGE = 9999;

  /** True for a whole number a notebook page can have (1 to 9999). */
  function valid(number) {
    return typeof number === 'number' && number % 1 === 0 && number >= MIN_PAGE && number <= MAX_PAGE;
  }

  /** The valid numbers of a list, other than `except`. */
  function usable(list, except) {
    return (list || []).filter(function (number) { return valid(number) && number !== except; });
  }

  /**
   * The page numbers still to scan after `added` was scanned: every number above the highest known page (excluding `added`
   * itself, which the apply may already have stored) and below `added` that is not skipped, ascending.
   * Nothing is asked when no earlier page is known, or when `added` is at most the highest known page plus one.
   */
  function missing(known, added, skipped) {
    if (!valid(added)) return [];
    var before = usable(known, added);
    if (!before.length) return [];
    var highest = Math.max.apply(null, before);
    var skip = usable(skipped, added);
    var found = [];
    for (var number = highest + 1; number < added; number += 1) {
      if (skip.indexOf(number) < 0) found.push(number);
    }
    return found;
  }

  /** Folds ascending, unique numbers into runs: [12, 13, 14, 16] becomes [[12, 14], [16, 16]]. */
  function ranges(numbers) {
    var runs = [];
    numbers.forEach(function (number) {
      var last = runs[runs.length - 1];
      if (last && last[1] + 1 === number) last[1] = number;
      else runs.push([number, number]);
    });
    return runs;
  }

  L.gap.model = { missing: missing, ranges: ranges, valid: valid };
})();
