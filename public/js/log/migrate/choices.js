/*
 * The three migration choices of one task (Keep, Schedule, Drop) and what each does. The migration review and the "not on paper" list
 * build the same buttons from here, and a choice runs through move/pick.js exactly like a row swipe. No fetch of its own.
 * Needs ak-dom.js, copy.js, glyph.js and move/pick.js (with move/model.js).
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};
  L.migrate = L.migrate || {};

  /** One of the three choices: the glyph, the word and a hint under it. */
  function choice(action, type, label, hint, busy, run) {
    return h('button', {
      class: 'migrate-choice', type: 'button', 'data-action': action, 'data-testid': 'migrate-' + action, disabled: busy, onclick: function () { run(action); }
    }, L.glyph.typeGlyph(type), h('span', { class: 'migrate-choice-text' }, h('span', { class: 'migrate-choice-label' }, label), h('span', { class: 'migrate-choice-hint' }, hint)));
  }

  /** The group of the three choices. busy greys them while a save runs, run(action) gets 'keep', 'schedule' or 'drop'. */
  function view(busy, run) {
    var words = L.copy.migrate;
    return h('div', { class: 'migrate-choices', role: 'group', 'aria-label': words.choicesLabel },
      choice('keep', 'migrated', words.keep, words.keepHint, busy, run),
      choice('schedule', 'scheduled', words.schedule, words.scheduleHint, busy, run),
      choice('drop', 'dropped', words.drop, words.dropHint, busy, run));
  }

  /**
   * Runs one choice on an entry. hooks: start() when a save begins, done(decision) with 'kept', 'scheduled' or 'dropped' once it is
   * saved, fail() when it was refused (a toast is shown). Schedule opens the chooser first; closing it with no pick calls nothing.
   */
  function decide(entry, action, today, hooks) {
    if (action === 'schedule') { schedule(entry, hooks); return; }
    hooks.start();
    var saved = action === 'keep' ? L.move.pick.move(entry, 'migrate', L.move.model.dayPlace(today)) : L.move.pick.drop(entry);
    saved.then(function () { hooks.done(action === 'keep' ? 'kept' : 'dropped'); }, function () { hooks.fail(); L.move.pick.fail(); });
  }

  /** Schedule opens the move chooser; a pick files the entry. */
  function schedule(entry, hooks) {
    L.move.pick.choose(entry, 'schedule', function (target) {
      L.move.chooser.close();
      hooks.start();
      L.move.pick.move(entry, 'schedule', target).then(function () { hooks.done('scheduled'); }, function () { hooks.fail(); L.move.pick.fail(); });
    }, true);
  }

  L.migrate.choices = { view: view, decide: decide };
})();
