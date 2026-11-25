/*
 * The notebook page row of the scan review: the page number written in the notebook, read from the photo and editable.
 * Shown for daily, future and month reviews. Empty is allowed. A view only: the rules live in scan/model.js.
 * Needs ak-dom.js, scan/copy.js and scan/model.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.scan = L.scan || {};

  /** The words under the field: the error while the number is not valid, else "read from the photo" while it is still the OCR number. */
  function noteText(state) {
    var copy = L.copy.scan;
    if (L.scan.model.paperNumberOf(state).invalid) return copy.errors.paperInvalid;
    return L.scan.model.paperFromPhoto(state) ? copy.review.paperHint : '';
  }

  /** The row: a label, a small numeric field and a quiet note. onChange() runs on each edit so the apply button follows. */
  function numberRow(state, onChange) {
    var copy = L.copy.scan.review;
    var input = h('input', {
      class: 'scan-number-input', type: 'text', inputmode: 'numeric', maxlength: 5, autocomplete: 'off', 'aria-label': copy.paperLabel,
      'data-field': 'paper-number', 'data-testid': 'scan-paper-number', value: state.paperText
    });
    var note = h('p', { class: 'scan-number-note', 'data-testid': 'scan-paper-note', role: 'status' });
    var node = h('div', { class: 'scan-number', 'data-testid': 'scan-paper-row' },
      h('label', { class: 'scan-number-line' }, h('span', { class: 'scan-number-label' }, copy.paperLabel), input), note);
    input.addEventListener('input', function () {
      L.scan.model.setPaperText(state, input.value);
      onChange();
    });
    return {
      node: node,
      refresh: function () {
        var text = noteText(state);
        if (input.value !== state.paperText) input.value = state.paperText;
        node.setAttribute('data-invalid', L.scan.model.paperNumberOf(state).invalid ? 'true' : 'false');
        input.setAttribute('aria-invalid', L.scan.model.paperNumberOf(state).invalid ? 'true' : 'false');
        note.hidden = text === '';
        note.textContent = text;
      }
    };
  }

  L.scan.number = { row: numberRow };
})();
