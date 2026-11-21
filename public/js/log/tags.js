/*
 * Pure helpers for the tag list of an entry: add, remove, compare and read from a text field. No DOM, no fetch, no strings.
 * Tags compare ignoring case, and the first spelling in a list wins. The caps mirror TAG_MAX and TAGS_MAX in src/log/validation.ts.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};

  var TAG_MAX = 40;
  var TAGS_MAX = 10;

  function key(tag) { return String(tag).trim().toLowerCase(); }

  /** The index of a tag in a list ignoring case, or -1. */
  function indexOf(list, tag) {
    var wanted = key(tag);
    for (var i = 0; i < list.length; i++) if (key(list[i]) === wanted) return i;
    return -1;
  }

  function has(list, tag) { return indexOf(list, tag) >= 0; }

  /** True for a tag the log accepts: one line of text, 1 to TAG_MAX characters once trimmed. */
  function isTag(text) {
    var tag = String(text).trim();
    return tag !== '' && tag.length <= TAG_MAX && !/[\u0000-\u001f\u007f]/.test(tag);
  }

  /** A new list with the tag at the end. The list itself when the tag is there already, is not a tag, or the list is full. */
  function add(list, tag) {
    if (!isTag(tag) || has(list, tag) || list.length >= TAGS_MAX) return list;
    return list.concat([String(tag).trim()]);
  }

  /** A new list without the tag (ignoring case). */
  function remove(list, tag) {
    var wanted = key(tag);
    return list.filter(function (one) { return key(one) !== wanted; });
  }

  /** True when both lists hold the same tags, in any order, ignoring case. */
  function same(a, b) {
    return a.length === b.length && a.every(function (tag) { return has(b, tag); });
  }

  /** The spelling the pool already has for a tag that differs only in case, else the tag as it is. pool: [{ tag }]. */
  function spell(tag, pool) {
    var wanted = key(tag);
    for (var i = 0; i < pool.length; i++) if (key(pool[i].tag) === wanted) return pool[i].tag;
    return tag;
  }

  /** The tags a text field holds: words split at spaces and commas, a leading # dropped, repeats and over-long words skipped. */
  function parse(text) {
    var list = [];
    String(text).split(/[\s,]+/).forEach(function (word) {
      var tag = word.replace(/^#+/, '');
      if (tag !== '' && tag.length <= TAG_MAX) list = add(list, tag);
    });
    return list;
  }

  /** The tags as a field shows them, separated by spaces. */
  function join(list) { return list.join(' '); }

  /** The tags a field holds. A field left as it was shown gives the original list back, so a tag with a space in it survives. */
  function fromField(text, original) {
    return text.trim() === join(original) ? original.slice() : parse(text);
  }

  L.tags = {
    TAG_MAX: TAG_MAX, TAGS_MAX: TAGS_MAX, indexOf: indexOf, has: has, isTag: isTag, add: add, remove: remove,
    same: same, spell: spell, parse: parse, join: join, fromField: fromField
  };
})();
