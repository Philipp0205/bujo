/*
 * The body of the note sheet as a switchable editor: Edit shows the toolbar and the markdown textarea, Preview shows the rendered markdown.
 * The textarea stays in the page while previewing, so unsaved text survives a toggle and the sheet still reads its value to save.
 * Needs ak-dom.js, copy.js, note/editor/render.js, keymap.js and toolbar.js.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.note = L.note || {};
  L.note.editor = L.note.editor || {};

  /** One segment of the Edit / Preview switch. */
  function segment(action, label, onclick) {
    return h('button', { class: 'note-mode', type: 'button', 'data-action': action, 'aria-pressed': 'false', onclick: onclick }, label);
  }

  /** Shows or hides a node with the hidden attribute. */
  function show(node, on) {
    node.hidden = !on;
  }

  /**
   * Builds the editor. parts.area is the textarea, parts.field its labelled field, parts.editing the start mode.
   * Returns the root node; the sheet reads the textarea as before.
   */
  function create(parts) {
    var copy = L.copy.note.editor;
    var area = parts.area;
    var toolbar = L.note.editor.toolbar.create(area);
    var preview = h('div', { class: 'note-preview', 'data-testid': 'note-preview' });
    var editBtn = segment('note-edit', copy.edit, function () { set(true, true); });
    var previewBtn = segment('note-preview', copy.preview, function () { set(false, false); });
    var root = h('div', { class: 'note-editor' }, h('div', { class: 'note-modes', role: 'group', 'aria-label': copy.modes }, editBtn, previewBtn), toolbar, parts.field, preview);

    /** Switches mode. Entering preview renders the current text; entering edit can move focus to the textarea. */
    function set(editing, focus) {
      if (!editing) preview.innerHTML = L.note.editor.render(area.value);
      root.setAttribute('data-state', editing ? 'edit' : 'preview');
      show(toolbar, editing);
      show(parts.field, editing);
      show(preview, !editing);
      editBtn.setAttribute('aria-pressed', String(editing));
      previewBtn.setAttribute('aria-pressed', String(!editing));
      if (editing && focus) area.focus();
    }

    L.note.editor.keymap.bind(area);
    set(parts.editing, false);
    return root;
  }

  L.note.editor.view = { create: create };
})();
