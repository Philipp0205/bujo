/*
 * Keyboard and state glue of the note editor: puts an edit result into the textarea, and handles Enter and Tab in lists.
 * Needs note/editor/edit.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};
  L.note.editor = L.note.editor || {};

  /** The textarea text and selection as the pure helpers take them. */
  function stateOf(area) {
    return { value: area.value, start: area.selectionStart, end: area.selectionEnd };
  }

  /** Writes an edit result (or nothing, for null) into the textarea, keeps the selection and tells listeners the text changed. */
  function apply(area, result) {
    if (!result) return false;
    area.value = result.value;
    area.setSelectionRange(result.start, result.end);
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  /** The edit a key press asks for, or null: Enter continues a list, Tab and Shift+Tab indent and outdent it. */
  function resultFor(event, state) {
    var edit = L.note.editor.edit;
    if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && !event.isComposing) return edit.enter(state);
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) return edit.indent(state, event.shiftKey);
    return null;
  }

  /** Listens on the textarea for Enter and Tab. Tab never moves focus out of the note text. */
  function bind(area) {
    area.addEventListener('keydown', function (event) {
      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) event.preventDefault();
      if (apply(area, resultFor(event, stateOf(area))) && event.key === 'Enter') event.preventDefault();
    });
  }

  L.note.editor.keymap = { bind: bind, apply: apply, stateOf: stateOf };
})();
