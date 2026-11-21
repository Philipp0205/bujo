/*
 * The small popovers of the accessory bar: Type, Tag, Date and Time. They build nodes and call back, nothing else.
 * Needs ak-dom.js, copy.js and glyph.js. cb has type(t), tag(text), date(iso), time(hhmm or ''), close().
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

  /** The tag field: it updates the line on every key, and Enter closes the popover. */
  function tagPop(line, cb) {
    var input = h('input', {
      class: 'pop-input', type: 'text', name: 'tag', maxlength: 40, autocomplete: 'off',
      'aria-label': L.copy.inline.popLabels.tag, value: line.tag || ''
    });
    input.addEventListener('input', function () { cb.tag(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      cb.close();
    });
    return h('div', { class: 'pop-row' }, input, clearButton(input, cb.tag));
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
