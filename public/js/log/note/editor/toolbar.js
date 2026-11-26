/*
 * The formatting toolbar of the note editor: Heading, Bold, Italic, List, Checkbox, Link. Each button runs a pure edit on the textarea.
 * Buttons keep the textarea focused (no focus change on press), so the keyboard stays up and the selection survives.
 * Needs ak-dom.js, copy.js, note/editor/edit.js and note/editor/keymap.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};
  L.note.editor = L.note.editor || {};

  /** The tools in order: id and the edit each runs on the state. */
  function tools(copy) {
    var edit = L.note.editor.edit;
    return [
      { id: 'heading', run: edit.heading },
      { id: 'bold', run: function (s) { return edit.wrap(s, '**', copy.boldHint); } },
      { id: 'italic', run: function (s) { return edit.wrap(s, '*', copy.italicHint); } },
      { id: 'list', run: edit.list },
      { id: 'checkbox', run: edit.checkbox },
      { id: 'link', run: function (s) { return edit.link(s, copy.linkText, copy.linkUrl); } }
    ];
  }

  /** One toolbar button for a tool, acting on the textarea. */
  function button(tool, copy, area) {
    var keymap = L.note.editor.keymap;
    var node = h('button', {
      class: 'note-tool note-tool-' + tool.id, type: 'button', 'data-action': 'md-' + tool.id, 'aria-label': copy.tools[tool.id], title: copy.tools[tool.id]
    }, copy.marks[tool.id]);
    node.addEventListener('pointerdown', function (event) { event.preventDefault(); });
    node.addEventListener('mousedown', function (event) { event.preventDefault(); });
    node.addEventListener('click', function () {
      area.focus();
      keymap.apply(area, tool.run(keymap.stateOf(area)));
    });
    return node;
  }

  /** The toolbar row for a textarea. */
  function create(area) {
    var copy = L.copy.note.editor;
    return h('div', { class: 'note-toolbar', role: 'toolbar', 'aria-label': copy.toolbar, 'data-testid': 'note-toolbar' },
      tools(copy).map(function (tool) { return button(tool, copy, area); }));
  }

  L.note.editor.toolbar = { create: create };
})();
