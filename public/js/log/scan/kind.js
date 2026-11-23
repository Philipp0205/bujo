/*
 * The page-kind parts of the scan review: the kind switch, the month row of a calendar or month-task page, the place field of a
 * row (a day on a calendar page, a month on a future page) and the group headings. Views only: the rules live in scan/model.js.
 * Needs ak-dom.js, copy.js, scan/copy.js, scan/model.js, dates.js, horizon/model.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var KINDS = ['daily', 'future', 'calendar', 'month-task'];
  var FUTURE_MONTHS = 24;

  /** The kind switch: four pills. onPick(kind) runs when another one is tapped. Returns the node and a show() that marks the kind on the state. */
  function kindSwitch(state, onPick) {
    var copy = L.copy.scan.review;
    var note = h('p', { class: 'scan-kind-note', 'data-testid': 'scan-kind-source' });
    var buttons = KINDS.map(function (kind) {
      return h('button', { class: 'scan-kind', type: 'button', 'data-kind': kind, onclick: function () { if (kind !== state.kind) onPick(kind); } }, copy.kinds[kind]);
    });
    var node = h('div', { class: 'scan-kinds' },
      h('div', { class: 'scan-kind-pills', role: 'group', 'aria-label': copy.kindGroup, 'data-testid': 'scan-kinds' }, buttons), note);
    return {
      node: node,
      show: function (busy) {
        buttons.forEach(function (button) {
          button.setAttribute('aria-pressed', button.getAttribute('data-kind') === state.kind ? 'true' : 'false');
          button.disabled = busy;
        });
        note.textContent = copy.kindSource[state.kindSource];
      }
    };
  }

  /** The month row of a calendar or month-task page: a mini page icon, the month, and an invisible month input over all of it. */
  function monthRow(state, onPick) {
    var copy = L.copy.scan.review;
    var month = h('span', { class: 'scan-day', 'data-testid': 'scan-month' });
    var caption = h('span', { class: 'scan-source' }, copy.monthCaption);
    var input = h('input', { class: 'scan-date-input', type: 'month', 'aria-label': copy.month, 'data-field': 'month', value: state.month });
    input.addEventListener('change', function () {
      if (!input.value) return;
      L.scan.model.setMonth(state, input.value);
      onPick();
    });
    var node = h('label', { class: 'scan-date' }, L.glyph.use('g-scan-page', { viewBox: '0 0 40 52', width: 40, height: 52 }),
      h('span', { class: 'scan-date-text' }, month, caption), input);
    return {
      node: node,
      refresh: function () {
        month.textContent = copy.monthLabel(state.month);
        input.value = state.month;
      }
    };
  }

  /** The months a future line can move to: the next two years from this month, plus the one the line holds. */
  function monthChoices(current) {
    var first = L.pages.model.monthOf(L.dates.todayIso());
    var months = [];
    for (var step = 0; step < FUTURE_MONTHS; step += 1) months.push(L.pages.model.shiftMonth(first, step));
    if (current && months.indexOf(current) < 0) months.push(current);
    return months.sort();
  }

  /** The month select of a future row. */
  function monthSelect(item, onChange) {
    var copy = L.copy.scan.review;
    var select = h('select', { class: 'scan-place scan-place-month', 'aria-label': copy.month, 'data-field': 'month' });
    function fill() {
      var choices = monthChoices(item.month);
      select.replaceChildren.apply(select, [h('option', { value: '' }, copy.noMonth)].concat(choices.map(function (month) {
        return h('option', { value: month }, copy.monthLabel(month));
      })));
      select.value = item.month || '';
    }
    select.addEventListener('change', function () {
      item.month = select.value || null;
      onChange();
    });
    return { node: select, show: fill };
  }

  /** The day input of a calendar row: a small number field. */
  function dayInput(item, onChange) {
    var copy = L.copy.scan.review;
    var input = h('input', { class: 'scan-place scan-place-day', type: 'text', inputmode: 'numeric', maxlength: 2, autocomplete: 'off', placeholder: copy.dayLabel, 'aria-label': copy.dayLabel, 'data-field': 'day', value: item.dayText });
    input.addEventListener('input', function () { item.dayText = input.value; });
    input.addEventListener('change', function () { onChange(); });
    return { node: input, show: function () { if (document.activeElement !== input) input.value = item.dayText; } };
  }

  /** The place field of a row for a kind: a day on a calendar page, a month on a future page, else nothing (node null). */
  function placeField(state, item, onChange) {
    if (state.kind === 'calendar') return dayInput(item, onChange);
    if (state.kind === 'future') return monthSelect(item, onChange);
    return { node: null, show: function () {} };
  }

  /** The heading of a group of rows: a month of a future page or a day of a calendar page. */
  function groupHeading(state, key) {
    var copy = L.copy.scan.review;
    var text;
    if (state.kind === 'future') text = key ? copy.monthLabel(key) : copy.noMonth;
    else text = key ? L.dates.dayHeading(state.month + '-' + key) : copy.noDay;
    return h('h3', { class: 'scan-group', 'data-group': key }, text);
  }

  L.scan.kind = { KINDS: KINDS, kindSwitch: kindSwitch, monthRow: monthRow, placeField: placeField, groupHeading: groupHeading };
})();
