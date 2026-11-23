/*
 * The migration review sheet: the open tasks of earlier days, one at a time, oldest first. Each is kept (moved to today, a > trace
 * stays), scheduled (the move chooser, a < trace stays) or dropped (struck out, same entry). "Keep all remaining" moves the rest to
 * today. It ends with a short tally. Closing early leaves the unreviewed tasks where they are. No fetch of its own: the moves go
 * through move/pick.js. Needs ak-dom.js, nav/overlays.js, copy.js, dates.js, glyph.js, migrate/model.js and move/pick.js.
 * options: entries() the entries on screen, today().
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.migrate = L.migrate || {};

  /** The sheet: its parts to redraw, and the review state (ids still to ask about, and what was decided). */
  function shell() {
    var sub = h('p', { class: 'sheet-sub', 'data-testid': 'migrate-sub', 'aria-live': 'polite' });
    var body = h('div', { class: 'ak-sheet-scroll' });
    var dock = h('div', { class: 'ak-sheet-dock' });
    var node = h('div', { class: 'ak-sheet sheet-entry sheet-migrate', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'migrate-title', 'data-testid': 'migrate-review' },
      h('div', { class: 'ak-sheet-head' }, h('div', { class: 'ak-grabber' }), h('h2', { class: 'sheet-title', id: 'migrate-title' }, L.copy.migrate.title), sub),
      body, dock);
    return { node: node, sub: sub, body: body, dock: dock };
  }

  /** One of the three choices of an item: the glyph, the word and a hint under it. */
  function choice(action, type, label, hint, state, run) {
    return h('button', {
      class: 'migrate-choice', type: 'button', 'data-action': action, 'data-testid': 'migrate-' + action, disabled: state.busy, onclick: run
    }, L.glyph.typeGlyph(type), h('span', { class: 'migrate-choice-text' }, h('span', { class: 'migrate-choice-label' }, label), h('span', { class: 'migrate-choice-hint' }, hint)));
  }

  /** The open task being asked about: its day, its title and the three choices. */
  function itemView(entry, state, run) {
    var words = L.copy.migrate;
    return [
      h('p', { class: 'migrate-day', 'data-testid': 'migrate-day' }, L.dates.dayHeading(entry.date)),
      h('p', { class: 'migrate-title', 'data-testid': 'migrate-item' }, entry.title),
      h('div', { class: 'migrate-choices', role: 'group', 'aria-label': words.choicesLabel },
        choice('keep', 'migrated', words.keep, words.keepHint, state, function () { run('keep'); }),
        choice('schedule', 'scheduled', words.schedule, words.scheduleHint, state, function () { run('schedule'); }),
        choice('drop', 'dropped', words.drop, words.dropHint, state, function () { run('drop'); }))
    ];
  }

  /** The end tally: n kept, n scheduled, n dropped. */
  function summaryView(state) {
    var words = L.copy.migrate;
    var count = L.migrate.model.tally(state.decisions);
    return h('ul', { class: 'migrate-tally', 'data-testid': 'migrate-summary' },
      h('li', { 'data-testid': 'migrate-kept' }, words.kept(count.kept)),
      h('li', { 'data-testid': 'migrate-scheduled' }, words.scheduled(count.scheduled)),
      h('li', { 'data-testid': 'migrate-dropped' }, words.dropped(count.dropped)));
  }

  /** The entry now being asked about (read again from the page, so it is the live one), or null when the review is over. */
  function current(state, options) {
    while (state.index < state.ids.length) {
      var id = state.ids[state.index];
      var entry = options.entries().filter(function (item) { return item.id === id; })[0];
      if (entry && entry.type === 'task') return entry;
      state.index += 1;
    }
    return null;
  }

  /** The dock buttons: keep all remaining and Close while asking, Close alone at the end. */
  function dockOf(entry, state, onKeepAll, onClose) {
    var close = h('button', { class: 'ak-btn ak-btn-quiet', type: 'button', 'data-action': 'migrate-close', onclick: onClose }, L.copy.migrate.close);
    if (!entry) return [close];
    var all = h('button', { class: 'ak-btn', type: 'button', 'data-action': 'keep-all', disabled: state.busy, onclick: onKeepAll }, L.copy.migrate.keepAll);
    return [all, close];
  }

  /** Redraws the sheet for the state: the item, the empty note or the tally. */
  function paint(parts, state, options, actions) {
    var words = L.copy.migrate;
    var entry = current(state, options);
    var empty = state.ids.length === 0;
    parts.sub.textContent = entry ? words.progress(state.index + 1, state.ids.length) : empty ? words.emptySub : words.doneSub;
    var content = entry ? itemView(entry, state, actions.run) : empty ? h('p', { class: 'migrate-empty', 'data-testid': 'migrate-empty' }, words.empty) : summaryView(state);
    parts.body.replaceChildren.apply(parts.body, [].concat(content));
    parts.dock.replaceChildren.apply(parts.dock, dockOf(entry, state, actions.keepAll, actions.close));
  }

  /** Opens the sheet over the log. Returns the kit's handle, or null when another sheet is open. */
  function open(options) {
    var state = { ids: L.migrate.model.open(options.entries(), options.today()).map(function (entry) { return entry.id; }), index: 0, decisions: [], busy: false };
    var parts = shell();
    var sheet = null;
    var actions = { run: null, keepAll: null, close: function () { sheet.close(); } };

    /** One decided item: it is tallied and the next one is asked about. */
    function decided(decision) {
      state.decisions.push(decision);
      state.index += 1;
      state.busy = false;
      paint(parts, state, options, actions);
    }

    /** A save was refused: the item stays to be decided again. */
    function refused() {
      state.busy = false;
      paint(parts, state, options, actions);
      L.move.pick.fail();
    }

    /** Runs the choice for the item on screen. */
    actions.run = function (action) {
      var entry = current(state, options);
      if (!entry || state.busy) return;
      if (action === 'schedule') { schedule(entry); return; }
      state.busy = true;
      var done = action === 'keep' ? L.move.pick.move(entry, 'migrate', L.move.model.dayPlace(options.today())) : L.move.pick.drop(entry);
      done.then(function () { decided(action === 'keep' ? 'kept' : 'dropped'); }, refused);
    };

    /** Schedule opens the move chooser; a pick files the item, closing the chooser with no pick leaves it undecided. */
    function schedule(entry) {
      L.move.pick.choose(entry, 'schedule', function (target) {
        L.move.chooser.close();
        state.busy = true;
        L.move.pick.move(entry, 'schedule', target).then(function () { decided('scheduled'); }, refused);
      }, true);
    }

    /** Keeps every item not decided yet, one after the other, then shows the tally. A refusal stops there. */
    actions.keepAll = function () {
      if (state.busy) return;
      state.busy = true;
      var next = function () {
        var entry = current(state, options);
        if (!entry) return Promise.resolve();
        return L.move.pick.move(entry, 'migrate', L.move.model.dayPlace(options.today())).then(function () {
          state.decisions.push('kept');
          state.index += 1;
          return next();
        });
      };
      next().then(function () { state.busy = false; paint(parts, state, options, actions); }, refused);
    };

    paint(parts, state, options, actions);
    sheet = BujoNav.overlays.showSheet(parts.node, { onClose: L.move.chooser.close });
    return sheet;
  }

  L.migrate.sheet = { open: open };
})();
