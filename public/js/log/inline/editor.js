/*
 * The inline editor: the one line of the rapid log that is being typed in the edit sheet, and what happens to it (save, drop, next line).
 * Application logic only. The nodes come from row.js, bar.js and edit-sheet.js, the page is drawn by the host (main.js).
 * Needs markup.js, tags.js, model.js, row.js, pop.js, bar.js, edit-sheet.js, complete.js, viewport.js, keyboard.js, layers.js, api.js, copy.js, clipboard.js.
 * One Back ends the edit and the keyboard together: a history pop (see layers.js) or a soft keyboard that was up and went away.
 *
 * host: today(), draw() renders the page, entries() the entries on screen, upsert(entry) keeps the state in step with a saved entry,
 *       replaceDay(date, entries) swaps a day for the server's list, dayEntries(date) reads a day in order,
 *       openSheet(entry) opens the details sheet.
 * The sheet and its input stay in the page while a line is active, so a redraw of the list never moves the focus.
 * At most one line is active. Blur and Escape save a non-empty line and drop an empty one. Enter saves and starts the next.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.inline = L.inline || {};

  var model = null;
  var bar = null;
  var sheet = null;
  var host = null;
  var active = null;
  var muted = false;
  var acting = false;
  var copying = false;
  var pressed = false;
  var blurred = null;

  /** The text input of the active line, or null before the sheet is mounted. */
  function titleInput() {
    return document.querySelector('.paper-edit-input');
  }

  /** Runs fn with blur handling off: moving or removing the focused input fires a blur that the person did not cause. */
  function quietly(fn) {
    var before = muted;
    muted = true;
    try { fn(); } finally { muted = before; }
  }

  /** Puts the caret at the end of the title input and focuses it, so the keyboard stays up. */
  function focusTitle() {
    var input = titleInput();
    if (!input) return;
    quietly(function () {
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  /** What the bar keys may do for the active line. A key is off when there is no neighbour or when the day is being changed. Copy needs a title. */
  function caps() {
    if (!active) return { copy: false, up: false, down: false, indent: false, outdent: false };
    var saved = !active.isNew && active.date === active.original.date;
    var day = host.dayEntries(active.isNew ? active.date : active.original.date);
    var at = day.findIndex(function (entry) { return entry.id === active.id; });
    var nested = active.indent === 1;
    return {
      copy: model.hasTitle(active),
      up: saved && at > 0,
      down: saved && at >= 0 && at < day.length - 1,
      indent: !nested && (active.isNew ? day.length > 0 : saved && at > 0),
      outdent: nested
    };
  }

  /** Shows the bar for the active line with the keys that can act right now. */
  function showBar() {
    bar.show(active, caps());
  }

  /** Tells the Back layers what is open now: the sheet while a line is active, and the bar popover. */
  function syncLayers() {
    L.inline.layers.update();
  }

  /** Blurs the title so the soft keyboard stays closed once the sheet is gone. Not a person's blur, so it saves nothing by itself. */
  function dismissKeyboard() {
    var input = titleInput();
    if (input && input === document.activeElement) quietly(function () { input.blur(); });
  }

  /** Back on the sheet (history pop or the keyboard going away): the keyboard and the sheet close together, saving like Escape. */
  function closeWithKeyboard() {
    dismissKeyboard();
    return commit(false);
  }

  /** The Android Back that only dismissed the keyboard fires no popstate, so it ends the edit here. An open popover closes first instead. */
  function onKeyboardDismissed() {
    if (bar.popOpen()) {
      quietly(function () { bar.closePop(); });
      syncLayers();
      return;
    }
    closeWithKeyboard();
  }

  /** The visual viewport moved: the sheet follows the keyboard, a dismissed keyboard ends the edit, the card stays above the sheet. */
  function onViewport() {
    sheet.place();
    if (!active) return;
    if (L.inline.keyboard.track()) onKeyboardDismissed();
    else reveal();
  }

  /** The card (or the add row) the sheet must not cover: the card of a saved entry, the end of the day for a new one. */
  function anchorNode() {
    if (!active) return null;
    if (!active.isNew) {
      var row = document.querySelector('.paper-row[data-id="' + active.id + '"]');
      return row ? row.closest('.entry-card') : null;
    }
    return document.querySelector('.paper-add') || document.querySelector('.paper-day-group[data-date="' + active.home + '"]');
  }

  /** Scrolls the list so the card being edited ends above the sheet. */
  function reveal() {
    var anchor = anchorNode();
    if (anchor && sheet.element()) L.inline.viewport.reveal(anchor, sheet.element());
  }

  /** The sheet follows the active line: shown with its draft, caret and focus, or hidden when nothing is being typed. */
  function sync(caret) {
    document.documentElement.classList.toggle('is-editing', !!active);
    if (!active) { quietly(function () { bar.closePop(); sheet.hide(); }); L.inline.complete.hide(); syncLayers(); return; }
    sheet.show();
    L.inline.row.update(active);
    showBar();
    syncLayers();
    var input = titleInput();
    if (input.value !== active.title) L.inline.row.setTitle(input, active.title);
    else L.inline.row.grow(input);
    if (!document.activeElement || !document.activeElement.closest('.inline-bar')) focusTitle();
    if (caret) input.setSelectionRange(caret.start, caret.end);
    reveal();
  }

  /** The caret of the title being typed, so a redraw in the middle of a word does not move it. */
  function caretOf() {
    var input = titleInput();
    return input && input === document.activeElement ? { start: input.selectionStart, end: input.selectionEnd } : null;
  }

  /** Redraws the list behind the sheet and puts the sheet in step with the active line. */
  function paint() {
    var caret = caretOf();
    quietly(function () { host.draw(); });
    sync(caret);
  }

  /** Makes a line the active one and shows it in the sheet, focused. Runs inside the tap that asked for it, so the keyboard opens. */
  function start(line) {
    active = line;
    L.inline.keyboard.reset();
    L.inline.complete.hide();
    L.suggest.pool.refresh();
    quietly(function () { bar.closePop(); });
    paint();
  }

  /** Leaves editing: no active line, sheet hidden, list drawn from the state. */
  function end() {
    active = null;
    paint();
  }

  /** An empty line is not saved: a new one is dropped, an existing one keeps its saved title. Nothing is sent or deleted. */
  function abandon(line, next) {
    if (next) start(model.blank(host.today()));
    else end();
    return { ok: true, entry: line.original };
  }

  /** The text for a failed save: the server's own short reason when it sent one, else the copy line. */
  function failure(error) {
    return error && error.status && error.message ? error.message : L.copy.errors.lineFailed;
  }

  /** Sends a line: POST for a new one (then its indent, which a create does not take), PATCH with only the changes for an existing one. */
  function send(line, body) {
    if (!line.isNew) return L.api.update(line.id, body);
    return L.api.create(body).then(function (entry) {
      return line.indent === 1 ? L.api.update(entry.id, { indent: 1 }) : entry;
    });
  }

  /** Locks the title while a save is in flight, without closing the keyboard. */
  function lock(on) {
    var input = titleInput();
    if (input) input.readOnly = on;
  }

  /** What follows a good save: end, or the next line (on the same day when the saved entry landed there). The sheet stays open. */
  function saved(line, entry, next) {
    if (!next) end();
    else if (line.isNew && entry.date === line.home) start(model.blank(line.home));
    else start(model.blank(host.today()));
  }

  /** A failed save keeps the line open with its draft and a short error. */
  function failed(line, error) {
    line.error = failure(error);
    L.inline.row.update(line);
    focusTitle();
  }

  /** Sends the changes of a line. Resolves { ok, entry }. */
  function persist(line, body, next) {
    lock(true);
    line.saving = send(line, body).then(function (entry) {
      line.saving = null;
      lock(false);
      host.upsert(entry);
      saved(line, entry, next);
      return { ok: true, entry: entry };
    }, function (error) {
      line.saving = null;
      lock(false);
      failed(line, error);
      return { ok: false, entry: null };
    });
    return line.saving;
  }

  /** Reads the written #tags, day and time of the line before it is saved, and shows the cleaned title. */
  function settleMarkup(line) {
    model.settle(line, markupContext());
    var input = titleInput();
    if (input && input.value !== line.title) L.inline.row.setTitle(input, line.title);
    L.inline.row.update(line);
  }

  /** Saves the active line (or drops or cancels it when the title is empty). next starts a fresh line after. */
  function commit(next) {
    var line = active;
    if (!line) return Promise.resolve({ ok: true, entry: null });
    if (line.saving) return line.saving;
    settleMarkup(line);
    if (!model.hasTitle(line)) return Promise.resolve(abandon(line, next));
    var body = model.changes(line);
    if (!line.isNew && Object.keys(body).length === 0) return Promise.resolve(abandon(line, next));
    return persist(line, body, next);
  }

  /** Runs make once the active line is saved or dropped. With no active line it runs at once, inside the tap. */
  function settle(make) {
    if (!active) { make(); return; }
    commit(false).then(function (result) { if (result.ok) make(); });
  }

  /** The "+ Add entry" tap and the empty space: a new line, or the next one when a line is already being typed. */
  function addLine() {
    if (!active) { start(model.blank(host.today())); return; }
    if (active.saving) { active.saving.then(function (result) { if (result.ok) start(model.blank(host.today())); }); return; }
    if (active.isNew && !model.hasTitle(active)) { focusTitle(); return; }
    commit(true);
  }

  /** A tap on a saved row: type in its title, after any other line is settled. */
  function editEntry(entry) {
    settle(function () { start(model.fromEntry(entry)); });
  }

  /** Saves the line, then opens the details sheet of the saved entry. */
  function details() {
    commit(false).then(function (result) {
      if (result.ok && result.entry) host.openSheet(result.entry);
    });
  }

  /** The tags the person already uses: the server's list merged with the entries on screen. */
  function tagPool() {
    return L.suggest.pool.items(host.entries());
  }

  /** What reading the markup of a line needs: the day "@morgen" counts from and the spelling of known tags. */
  function markupContext() {
    return { today: host.today(), known: tagPool() };
  }

  /** True when the caret sits after the last character, so cleaning the text cannot jump the caret. */
  function caretAtEnd(input, value) {
    return !!input && input.selectionStart === value.length && input.selectionEnd === value.length;
  }

  /** Shows the suggestions for the word at the caret, or hides them (no line, a popover open, an IME composing). */
  function refreshStrip(composing) {
    var input = titleInput();
    var live = active && !bar.popOpen() && input === document.activeElement;
    if (live) L.inline.complete.update(active, input, composing);
    else L.inline.complete.hide();
  }

  /** The text of a written #tag or @date, moved into the line. Cleans the input when the caret is at the end. */
  function absorbTyped(value, composing) {
    var input = titleInput();
    var context = markupContext();
    var cleaned = !composing && caretAtEnd(input, value) && model.absorb(active, value, { final: false, today: context.today, known: context.known });
    if (cleaned) {
      L.inline.row.setTitle(input, active.title);
      input.setSelectionRange(active.title.length, active.title.length);
    }
    return !!cleaned;
  }

  /**
   * Every keystroke lands in the draft, so a redraw never loses it. A shown error goes away. A tag, day or time written at the
   * end of the line becomes a pill as soon as its word is finished (not while the person composes with an IME).
   */
  function typed(value, composing) {
    active.title = value;
    active.edited = true;
    var cleaned = absorbTyped(value, composing);
    refreshStrip(composing);
    reveal();
    showBar();
    if (!cleaned && !active.error) return;
    active.error = '';
    L.inline.row.update(active);
  }

  /** A suggestion was chosen: its word replaces the one being typed, the caret goes after it, and it becomes a pill like a typed one. */
  function picked(option, token) {
    var input = titleInput();
    if (!active || !input || !token) return;
    var next = L.suggest.token.apply(input.value, token, option.insert);
    L.inline.row.setTitle(input, next.text);
    input.setSelectionRange(next.caret, next.caret);
    focusTitle();
    typed(next.text, false);
    input.setSelectionRange(Math.min(next.caret, input.value.length), Math.min(next.caret, input.value.length));
  }

  /** Closes the bar popover and gives the focus back to the title. */
  function closePop() {
    quietly(function () { bar.closePop(); });
    syncLayers();
    focusTitle();
  }

  /** A failed bar action says so on the line and leaves everything as it was. */
  function actionFailed() {
    active.error = L.copy.errors.actionFailed;
    L.inline.row.update(active);
  }

  /** Runs one request for a bar key, one at a time. onDone gets what the API answered. */
  function request(call, onDone) {
    if (acting) return;
    acting = true;
    call().then(function (result) {
      acting = false;
      if (active) onDone(result);
    }, function () {
      acting = false;
      if (active) actionFailed();
    });
  }

  /** Delete: a new line is just dropped, a saved one is removed from the log (never from Nextcloud). */
  function removeLine() {
    var line = active;
    if (line.isNew) { end(); return; }
    request(function () { return L.api.remove(line.id); }, function (entries) {
      host.replaceDay(line.original.date, entries);
      end();
    });
  }

  /** Up or down: swaps the saved entry with its neighbour. The line stays active and keeps its draft. */
  function moveLine(direction) {
    var line = active;
    request(function () { return L.api.move(line.id, direction); }, function (entries) {
      host.replaceDay(line.original.date, entries);
      paint();
    });
  }

  /** Indent or outdent: saved at once for a saved entry (the list behind the sheet redraws), a draft choice for a new line. */
  function nestLine(level) {
    var line = active;
    if (line.isNew) { line.indent = level; L.inline.row.update(line); showBar(); return; }
    request(function () { return L.api.update(line.id, { indent: level }); }, function (entry) {
      host.upsert(entry);
      line.original = entry;
      line.indent = entry.indent;
      paint();
    });
  }

  /**
   * Copy: the draft of the line goes to the clipboard as one paper line (the markup in the title is read first, like a save does).
   * The sheet stays open. The kit's textarea fallback takes the focus for a moment, so the blur is not a person's and the title gets the focus back.
   */
  function copyLine() {
    var line = active;
    settleMarkup(line);
    if (!model.hasTitle(line)) { showBar(); return; }
    var entry = { type: line.type, title: line.title.trim(), tags: line.tags, time: line.time, date: line.date };
    copying = true;
    L.clipboard.copy([entry]).then(function () {
      copying = false;
      if (active) focusTitle();
    });
  }

  /** A tap on an action key of the bar. A key that cannot act right now does nothing. */
  function act(name) {
    if (!active || acting) return;
    if (name === 'copy') copyLine();
    else if (name === 'remove') removeLine();
    else if (!caps()[name]) return;
    else if (name === 'up' || name === 'down') moveLine(name);
    else nestLine(name === 'indent' ? 1 : 0);
  }

  /** Says the tag list is full, on the line, until the next keystroke. */
  function tagsFull() {
    active.error = L.copy.inline.tagsFull;
    L.inline.row.update(active);
  }

  /** Puts a tag on the line or takes it off (a full line says so). The popover stays open. */
  function toggleTag(tag) {
    if (!model.toggleTag(active, tag)) { tagsFull(); return; }
    active.error = '';
    L.inline.row.update(active);
  }

  /** The callbacks the popovers use. Each updates the line and the pills. A chosen day, time or type closes the popover. */
  function choices() {
    function set(key, value, close) {
      active[key] = value;
      L.inline.row.update(active);
      showBar();
      if (close) closePop();
    }
    return {
      type: function (type) { set('type', type, true); },
      tagPool: tagPool,
      tagToggle: toggleTag,
      tagAdd: function (text) { if (!L.tags.has(active.tags, text)) toggleTag(L.tags.spell(text, tagPool())); },
      tagClear: function () { set('tags', [], false); },
      date: function (iso) {
        if (!iso) return;
        if (iso !== active.date) active.indent = 0;
        set('date', iso, true);
      },
      time: function (hhmm) { set('time', hhmm || null, true); },
      close: closePop
    };
  }

  /** A tap on a bar key: open its popover, or close it when it is already open. The tag field takes focus to type in. */
  function toggle(kind) {
    if (!active) return;
    if (bar.popKind() === kind) { closePop(); return; }
    L.inline.complete.hide();
    bar.openPop(kind, active, choices());
    syncLayers();
    if (kind === 'tag') bar.popInput().focus();
  }

  /** Enter saves a non-empty line and starts the next. Backspace on an empty new line removes it. */
  function onTitleKey(event) {
    if (active.saving) return;
    if (L.inline.complete.key(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (model.hasTitle(active)) commit(true);
    } else if (event.key === 'Backspace' && active.isNew && event.target.value === '') {
      event.preventDefault();
      end();
    }
  }

  /** Escape closes an open popover first, otherwise it ends the edit like a blur does. Other keys go to the title. */
  function onKeyDown(event) {
    if (!active || event.isComposing) return;
    if (event.key === 'Escape') {
      if (bar.popOpen()) closePop();
      else commit(false);
    } else if (event.target === titleInput()) {
      onTitleKey(event);
    }
  }

  /** True for a node inside the editing zone: the line, the bar and its popover. */
  function inZone(node) {
    return !!(node && node.closest && node.closest('[data-edit-zone]'));
  }

  /** Ends the edit of a line whose focus left, once the press that took it is over (so the tap still reaches its target). */
  function releaseBlur() {
    pressed = false;
    var line = blurred;
    blurred = null;
    if (line && active === line && !line.saving && !inZone(document.activeElement)) commit(false);
  }

  /** Focus left the editing zone (title, bar, popover): that ends the edit like Escape does. */
  function onFocusOut(event) {
    if (!active || muted || copying || inZone(event.relatedTarget) || !inZone(event.target)) return;
    if (pressed) {
      blurred = active;
      window.setTimeout(releaseBlur, 400);
    } else {
      commit(false);
    }
  }

  /** True for a node the caret lives in (the title textarea, the tag input), so a tap on it may place the caret. */
  function isTextField(node) {
    return node.tagName === 'INPUT' || node.tagName === 'TEXTAREA';
  }

  /** A press inside the editing zone must not move focus off the title. A press outside an open popover only closes it. */
  function onMouseDown(event) {
    if (!active) return;
    pressed = true;
    var target = event.target;
    if (bar.popOpen() && !target.closest('.inline-pop, .inline-bar')) closePop();
    if (inZone(target) && !isTextField(target)) event.preventDefault();
  }

  /** The strip follows the caret too: a tap or an arrow key into another word, or the focus coming back, asks again. */
  function watchCaret(input) {
    ['keyup', 'click', 'focus'].forEach(function (name) {
      input.addEventListener(name, function (event) {
        if (active && !(name === 'keyup' && /^(Arrow(Down|Up)|Enter|Escape)$/.test(event.key))) refreshStrip(false);
      });
    });
  }

  /** Wires the editor to its host: the sheet with its strip and bar, the key and focus listeners, and the keyboard tracking. */
  function init(options) {
    host = options;
    model = L.inline.model;
    bar = L.inline.bar;
    sheet = L.inline.editSheet;
    var strip = L.inline.complete.init({
      entries: host.entries, today: host.today, picked: picked, shifted: function () { sheet.layout(); reveal(); }
    });
    var line = L.inline.row.build(typed);
    watchCaret(line.querySelector('.paper-edit-input'));
    sheet.mount(line, strip, bar.mount({ toggle: toggle, act: act, details: details }));
    L.suggest.pool.refresh();
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mouseup', function () { window.setTimeout(releaseBlur, 0); }, true);
    L.inline.layers.init({
      editing: function () { return !!active; },
      popOpen: bar.popOpen,
      commit: closeWithKeyboard,
      closePop: closePop
    });
    L.inline.viewport.follow(onViewport);
  }

  L.inline.editor = {
    init: init, paint: paint, addLine: addLine, editEntry: editEntry, settle: settle,
    line: function () { return active; }
  };
})();
