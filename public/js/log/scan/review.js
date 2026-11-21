/*
 * The scan review sheet (mock 05): the day, then one editable row per scanned line, then the apply button.
 * Rows are updated in place, never rebuilt, so a field keeps focus while the person types.
 * Needs ak-dom.js, ak-sheet.js, copy.js, scan/copy.js, scan/model.js, dates.js and glyph.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  var ICON = { viewBox: '0 0 16 16', width: 16, height: 16 };

  /** The words under a row title: confidence, a spelling hint when it is low, and what the day already holds. */
  function metaText(item) {
    var copy = L.copy.scan.review;
    var parts = [L.scan.model.percent(item) + '%'];
    if (item.time) parts.push(item.time);
    if (L.scan.model.isLowConfidence(item)) parts.push(copy.checkSpelling);
    if (item.status === 'duplicate') parts.push(copy.duplicate);
    if (item.status === 'completes') parts.push(copy.marksDone);
    return parts.join(' \u00b7 ');
  }

  /** The type picker: a native select laid transparently over the glyph, so the phone's own picker opens. */
  function typePicker(item, onChange) {
    var glyph = h('span', { class: 'scan-glyph' }, L.glyph.typeGlyph(item.type));
    var select = h('select', { class: 'scan-type', 'aria-label': L.copy.scan.review.type, 'data-field': 'type' },
      L.glyph.TYPES.map(function (type) {
        return h('option', { value: type, selected: type === item.type }, L.copy.typeLabels[type]);
      }));
    select.value = item.type;
    select.addEventListener('change', function () {
      item.type = select.value;
      onChange();
    });
    return {
      node: h('label', { class: 'scan-sym' }, glyph, select),
      show: function () { glyph.replaceChildren(L.glyph.typeGlyph(item.type)); select.value = item.type; }
    };
  }

  /** A text input that writes into the item as the person types and asks for a check when they leave it. */
  function textInput(item, field, attrs, onChange) {
    var input = h('input', Object.assign({ class: 'scan-input-' + field, type: 'text', autocomplete: 'off', 'data-field': field, value: item[field] }, attrs));
    input.addEventListener('input', function () { item[field] = input.value; onChange(false); });
    input.addEventListener('change', function () { onChange(true); });
    return input;
  }

  /** The keep or skip check at the end of a row. */
  function keepToggle(item, onToggle) {
    var copy = L.copy.scan.review;
    var button = h('button', { class: 'scan-keep', type: 'button', role: 'checkbox', 'data-field': 'include', onclick: function () {
      item.include = !item.include;
      item.touched = true;
      onToggle();
    } }, L.glyph.use('g-check', { viewBox: '0 0 24 24', width: 20, height: 20 }));
    return {
      node: button,
      show: function () {
        button.setAttribute('aria-checked', item.include ? 'true' : 'false');
        button.setAttribute('aria-label', item.include ? copy.drop : copy.keep);
      }
    };
  }

  /** One line of the page as an editable row. Returns its node and a refresh that redraws the changing parts. */
  function row(item, hooks) {
    var meta = h('span', { class: 'scan-meta' });
    var picker = typePicker(item, function () { hooks.changed(true); });
    var keep = keepToggle(item, function () { hooks.changed(false); });
    var title = textInput(item, 'title', { maxlength: 200, 'aria-label': L.copy.scan.review.titleLabel }, hooks.changed);
    var tag = textInput(item, 'tag', { maxlength: 40, placeholder: L.copy.scan.review.tag, 'aria-label': L.copy.scan.review.tagLabel }, function (leave) { hooks.changed(false, leave); });
    var node = h('div', { class: 'scan-row', 'data-id': item.id },
      picker.node,
      h('div', { class: 'scan-main' }, title, h('div', { class: 'scan-under' }, meta, tag)),
      keep.node);

    function refresh() {
      node.setAttribute('data-include', item.include ? 'true' : 'false');
      node.setAttribute('data-status', item.status);
      node.setAttribute('data-low', L.scan.model.isLowConfidence(item) ? 'true' : 'false');
      meta.textContent = metaText(item);
      picker.show();
      keep.show();
    }
    refresh();
    return { node: node, refresh: refresh };
  }

  /** The day row: a mini page icon, the day, where it came from, and an invisible date input over all of it. */
  function dateRow(state, onPick) {
    var copy = L.copy.scan.review;
    var day = h('span', { class: 'scan-day', 'data-testid': 'scan-date' });
    var source = h('span', { class: 'scan-source', 'data-testid': 'scan-date-source' });
    var input = h('input', { class: 'scan-date-input', type: 'date', 'aria-label': copy.date, 'data-field': 'date', value: state.date });
    input.addEventListener('change', function () {
      if (!input.value) return;
      L.scan.model.setDate(state, input.value);
      onPick();
    });
    var node = h('label', { class: 'scan-date' }, L.glyph.use('g-scan-page', { viewBox: '0 0 40 52', width: 40, height: 52 }),
      h('span', { class: 'scan-date-text' }, day, source), input);
    return {
      node: node,
      refresh: function () {
        day.textContent = L.dates.dayHeading(state.date);
        source.textContent = { page: copy.dateFromPage, fallback: copy.dateFallback, picked: copy.datePicked }[state.dateSource];
        input.value = state.date;
      }
    };
  }

  /** Opens the sheet. handlers.check(state) and handlers.apply(state) return promises, handlers.done(result) runs after a save. */
  function open(state, handlers) {
    var copy = L.copy.scan.review;
    var subtitle = h('p', { class: 'sheet-sub', 'data-testid': 'scan-sub' });
    var slot = h('div', { class: 'sheet-slot', 'aria-live': 'polite' });
    var apply = h('button', { class: 'ak-btn ak-btn-accent', type: 'button', 'data-action': 'apply' });
    var date = dateRow(state, function () { recheck(); });
    var rows = state.items.map(function (item) {
      return row(item, { changed: function (check, leave) { if (check || leave) recheck(); else refreshAll(); } });
    });
    var busy = false;
    var sheet = null;

    function say(message) { Bujo.say(slot, message); }

    /** Redraws the counts, the rows, the day and the apply button from the state. */
    function refreshAll() {
      var kept = L.scan.model.keptItems(state).length;
      var problem = L.scan.model.problem(state);
      subtitle.textContent = L.dates.dayHeading(state.date) + ' \u00b7 ' + copy.entries(kept);
      apply.textContent = busy ? copy.applying : copy.apply(kept);
      apply.disabled = busy || problem !== '';
      say(problem === 'title' ? L.copy.scan.errors.titleRequired : '');
      date.refresh();
      rows.forEach(function (entry) { entry.refresh(); });
    }

    /** Asks the server about the day and the edited lines, then redraws. A failed check keeps what is on screen. */
    function recheck() {
      refreshAll();
      handlers.check(state).then(function (answer) {
        L.scan.model.mergeChecks(state, answer);
        refreshAll();
      }, function () { /* the apply step checks again, so a missed hint is harmless */ });
    }

    function submit() {
      if (busy || L.scan.model.problem(state)) return;
      busy = true;
      refreshAll();
      handlers.apply(state).then(function (result) {
        sheet.close();
        handlers.done(result);
      }, function (error) {
        busy = false;
        refreshAll();
        say(error && error.message ? error.message : L.copy.scan.errors.applyFailed);
      });
    }

    apply.addEventListener('click', submit);
    var node = h('div', { class: 'ak-sheet sheet-entry sheet-scan', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'scan-review-title', 'data-testid': 'scan-review' },
      h('div', { class: 'ak-sheet-head' }, h('div', { class: 'ak-grabber' }), h('h2', { class: 'sheet-title', id: 'scan-review-title' }, copy.title), subtitle),
      h('div', { class: 'ak-sheet-scroll' }, slot, date.node, h('div', { class: 'scan-rows' }, rows.map(function (entry) { return entry.node; }))),
      h('div', { class: 'ak-sheet-dock' }, apply));
    refreshAll();
    sheet = AppKit.sheet.show(node, {});
    return sheet;
  }

  L.scan.review = { open: open };
})();
