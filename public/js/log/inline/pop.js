/*
 * The small popovers of the accessory bar: Type, Tags, Date and Time. They build nodes and call back, nothing else.
 * Needs ak-dom.js, copy.js, glyph.js, tags.js and suggest/fuzzy.js. cb has type(t), tagPool(), tagToggle(tag), tagAdd(text), tagClear(),
 * date(iso), time(hhmm or ''), close().
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  /** The six glyphs as buttons. The chosen one is pressed. */
  function typePop(line, cb) {
    return h('div', { class: 'pop-types', role: 'group', 'aria-label': L.copy.inline.popLabels.type },
      L.glyph.TYPES.map(function (type) {
        return h('button', {
          class: 'pop-type',
          type: 'button',
          'data-type': type,
          'aria-label': L.copy.typeLabels[type],
          title: L.copy.typeLabels[type],
          'aria-pressed': type === line.type ? 'true' : 'false',
          onclick: function () { cb.type(type); }
        }, L.glyph.typeGlyph(type));
      }));
  }

  /** A "Clear" button that empties an input and reports the empty value. */
  function clearButton(input, report) {
    return h('button', { class: 'pop-clear', type: 'button', onclick: function () {
      input.value = '';
      report('');
    } }, L.copy.inline.clear);
  }

  /** The pool tags plus the line's own, as { tag, count, lastUsed } items. The line's own come first on an empty query. */
  function tagItems(line, cb) {
    var own = line.tags.map(function (tag) { return { tag: tag, count: 0, lastUsed: Infinity }; });
    var seen = {};
    return own.concat(cb.tagPool()).filter(function (item) {
      var key = item.tag.toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /** One row of the tag list: the tag, pressed when the line has it. A tap toggles it. */
  function tagRow(line, item, cb, redraw) {
    var on = L.tags.has(line.tags, item.tag);
    return h('button', {
      class: 'pop-tag', type: 'button', 'data-tag': item.tag, role: 'option', 'aria-selected': on ? 'true' : 'false',
      onclick: function () { cb.tagToggle(item.tag); redraw(); }
    }, h('span', { class: 'pop-tag-mark', 'aria-hidden': 'true' }, on ? '\u2713' : ''), h('span', { class: 'pop-tag-name' }, '#' + item.tag));
  }

  /** The last row for a typed word that is no tag yet: "+ #word". */
  function newTagRow(text, cb, redraw) {
    return h('button', {
      class: 'pop-tag pop-tag-new', type: 'button', 'data-new': text, role: 'option',
      onclick: function () { cb.tagAdd(text); redraw(true); }
    }, h('span', { class: 'pop-tag-name' }, L.copy.inline.tagAdd(text)));
  }

  /** The words the search field holds as a tag: a leading # dropped, spaces trimmed. */
  function queryOf(input) {
    return input.value.replace(/^\s*#+/, '').trim();
  }

  /** The rows for the current query: ranked pool tags, then "+ #query" when it is a new tag. */
  function tagRows(line, input, cb, redraw) {
    var query = queryOf(input);
    var items = tagItems(line, cb);
    var ranked = L.suggest.fuzzy.rank(query, items, items.length);
    var rows = ranked.map(function (item) { return tagRow(line, item, cb, redraw); });
    var exists = L.tags.has(items.map(function (item) { return item.tag; }), query);
    if (query !== '' && L.tags.isTag(query) && !exists) rows.push(newTagRow(query, cb, redraw));
    if (!rows.length) rows.push(h('p', { class: 'pop-tag-empty' }, L.copy.inline.tagNone));
    return rows;
  }

  /** Enter in the search field: toggles an exact match, else adds the word as a new tag. Empty text closes the popover. */
  function submitTag(line, input, cb, redraw) {
    var query = queryOf(input);
    if (query === '') { cb.close(); return; }
    var match = tagItems(line, cb).filter(function (item) { return item.tag.toLowerCase() === query.toLowerCase(); })[0];
    if (match) cb.tagToggle(match.tag);
    else cb.tagAdd(query);
    redraw(true);
  }

  /** The tag popover: a search field over a short scrolling list. Tapping a tag toggles it, the popover stays open. */
  function tagPop(line, cb) {
    var input = h('input', {
      class: 'pop-input', type: 'text', name: 'tag', maxlength: 40, autocomplete: 'off', autocapitalize: 'off',
      placeholder: L.copy.inline.tagSearch, 'aria-label': L.copy.inline.tagSearchLabel
    });
    var list = h('div', { class: 'pop-tags', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': L.copy.inline.tagList });
    function redraw(clear) {
      if (clear === true) input.value = '';
      list.replaceChildren.apply(list, tagRows(line, input, cb, redraw));
    }
    input.addEventListener('input', function () { redraw(); });
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submitTag(line, input, cb, redraw);
    });
    var clear = h('button', { class: 'pop-clear', type: 'button', onclick: function () { cb.tagClear(); redraw(true); } }, L.copy.inline.clear);
    redraw();
    return h('div', { class: 'pop-tagpop' }, h('div', { class: 'pop-row' }, input, clear), list);
  }

  /** The day: a date field. A picked day closes the popover. */
  function datePop(line, cb) {
    var input = h('input', {
      class: 'pop-input', type: 'date', name: 'date', required: true,
      'aria-label': L.copy.inline.popLabels.date, value: line.date
    });
    input.addEventListener('change', function () { cb.date(input.value); });
    return h('div', { class: 'pop-row' }, input);
  }

  /** The time: an optional time field with a Clear button. */
  function timePop(line, cb) {
    var input = h('input', {
      class: 'pop-input', type: 'time', name: 'time',
      'aria-label': L.copy.inline.popLabels.time, value: line.time || ''
    });
    input.addEventListener('change', function () { cb.time(input.value); });
    return h('div', { class: 'pop-row' }, input, clearButton(input, cb.time));
  }

  var BUILDERS = { type: typePop, tag: tagPop, date: datePop, time: timePop };

  /** The popover node for one of the four keys. */
  function build(kind, line, cb) {
    return h('div', { class: 'inline-pop', 'data-pop': kind }, BUILDERS[kind](line, cb));
  }

  L.inline.pop = { build: build };
})();
