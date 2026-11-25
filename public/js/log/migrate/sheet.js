/*
 * The migration review sheet: the open tasks of earlier days, one at a time, oldest first. Each is kept (moved to today, a > trace
 * stays), scheduled (the move chooser, a < trace stays) or dropped (struck out, same entry). "Keep all remaining" moves the rest to
 * today. It ends with a short tally; when something was decided and the monthly-log nudge is not dismissed for today, the tally also
 * offers to open the monthly log. Closing early leaves the unreviewed tasks where they are. The moves go
 * through migrate/choices.js and move/pick.js. It reads the "not on paper" list once, only to put the page mark on a task that is
 * not written down yet; without that list it works as before. Needs ak-dom.js, nav/overlays.js, copy.js, dates.js, glyph.js, api.js,
 * paper/model.js, paper/view.js, migrate/model.js, migrate/choices.js, move/pick.js and remind/store.js.
 * options: entries() the entries on screen, today(), onOpenMonth() called after the sheet is closed.
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

  /** The open task being asked about: its day, its title (with the page mark when it is not on paper yet) and the three choices. */
  function itemView(entry, state, run) {
    var mark = state.off[entry.id] ? [' ', L.paper.view.rowMark()] : [];
    return [
      h('p', { class: 'migrate-day', 'data-testid': 'migrate-day' }, L.dates.dayHeading(entry.date)),
      h('p', { class: 'migrate-title', 'data-testid': 'migrate-item' }, [entry.title].concat(mark)),
      L.migrate.choices.view(state.busy, run)
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

  /** The monthly-log nudge under the tally: one line of text, and in the dock the button that opens it and a quiet Not now. */
  function nudgeParts(actions) {
    var words = L.copy.remind.monthly;
    return {
      text: h('p', { class: 'remind-text', 'data-testid': 'remind-monthly' }, words.text),
      dock: [
        h('button', { class: 'ak-btn', type: 'button', 'data-testid': 'remind-monthly-open', onclick: actions.openMonth }, words.open),
        h('button', { class: 'ak-btn ak-btn-quiet', type: 'button', 'data-testid': 'remind-monthly-later', onclick: actions.close }, words.later)
      ]
    };
  }

  /** Redraws the sheet for the state: the item, the empty note or the tally (with the monthly-log nudge after a finished migration). */
  function paint(parts, state, options, actions) {
    var words = L.copy.migrate;
    var entry = current(state, options);
    var empty = state.ids.length === 0;
    var nudge = !entry && !empty && state.decisions.length > 0 && L.remind.store.monthlyDue(options.today()) ? nudgeParts(actions) : null;
    state.nudged = !!nudge;
    parts.sub.textContent = entry ? words.progress(state.index + 1, state.ids.length) : empty ? words.emptySub : words.doneSub;
    var content = entry ? itemView(entry, state, actions.run) : empty ? h('p', { class: 'migrate-empty', 'data-testid': 'migrate-empty' }, words.empty) : summaryView(state);
    parts.body.replaceChildren.apply(parts.body, [].concat(content, nudge ? nudge.text : []));
    parts.dock.replaceChildren.apply(parts.dock, nudge ? nudge.dock : dockOf(entry, state, actions.keepAll, actions.close));
  }

  /** The sheet closed by any route: a monthly-log nudge that was on screen is done for today. */
  function closed(state, options) {
    L.move.chooser.close();
    if (state.nudged) L.remind.store.dismissMonthly(options.today());
  }

  /** Reads which entries are not on paper yet, to mark them in the review. Only a mark: a failed read leaves the review as it is. */
  function readOff(state, parts, options, actions) {
    var range = L.paper.model.range(options.today());
    L.api.listNotOnPaper(range.from, range.to).then(function (entries) {
      entries.forEach(function (entry) { state.off[entry.id] = true; });
      if (!state.closed) paint(parts, state, options, actions);
    }, function () {});
  }

  /** Opens the sheet over the log. Returns the kit's handle, or null when another sheet is open. */
  function open(options) {
    var state = { ids: L.migrate.model.open(options.entries(), options.today()).map(function (entry) { return entry.id; }), index: 0, decisions: [], busy: false, off: {}, closed: false };
    var parts = shell();
    var sheet = null;
    var actions = {
      run: null,
      keepAll: null,
      close: function () { sheet.close(); },
      openMonth: function () { sheet.close(); options.onOpenMonth(); }
    };

    /** One decided item: it is tallied and the next one is asked about. */
    function decided(decision) {
      state.decisions.push(decision);
      state.index += 1;
      state.busy = false;
      paint(parts, state, options, actions);
    }

    /** A save was refused: the item stays to be decided again (the toast is shown by the choices). */
    function refused() {
      state.busy = false;
      paint(parts, state, options, actions);
    }

    /** Runs the choice for the item on screen. */
    actions.run = function (action) {
      var entry = current(state, options);
      if (!entry || state.busy) return;
      L.migrate.choices.decide(entry, action, options.today(), { start: function () { state.busy = true; }, done: decided, fail: refused });
    };

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
      next().then(function () { state.busy = false; paint(parts, state, options, actions); }, function () { refused(); L.move.pick.fail(); });
    };

    paint(parts, state, options, actions);
    sheet = BujoNav.overlays.showSheet(parts.node, { onClose: function () { state.closed = true; closed(state, options); } });
    if (sheet) readOff(state, parts, options, actions);
    return sheet;
  }

  L.migrate.sheet = { open: open };
})();
