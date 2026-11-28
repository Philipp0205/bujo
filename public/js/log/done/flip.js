/*
 * What the person sees and feels when a row flips between task and done: the glyph and the title change in place at once, with a
 * short ink animation (log.css, .is-inking), and a small haptic pulse where the device has one. DOM only, no fetch.
 * Needs glyph.js, copy.js, paper/view.js and feel/feedback.js.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  L.done = L.done || {};

  /** The row of an entry on screen, or null. */
  function rowOf(id) {
    return document.querySelector('.paper-row[data-id="' + id + '"]');
  }

  /** Restarts the ink animation on the glyph and the title of a row. */
  function play(row) {
    if (!row) return;
    var parts = [row.querySelector('.paper-sym'), row.querySelector('.paper-title')];
    parts.forEach(function (part) { if (part) part.classList.remove('is-inking'); });
    void row.offsetWidth;
    parts.forEach(function (part) { if (part) part.classList.add('is-inking'); });
  }

  /** Shows a row as another type right away: its type, glyph and button name, and its "not on paper" mark (gone on a done row, back on a task that is not on paper). Then the ink plays. */
  function apply(row, type, marked) {
    if (!row) return;
    var sym = row.querySelector('.paper-sym');
    row.setAttribute('data-type', type);
    sym.replaceChildren(L.ink.bullet.node(type, row.getAttribute('data-id')));
    sym.setAttribute('aria-label', L.copy.done.toggle[type]);
    var mark = row.querySelector('[data-testid="not-on-paper-mark"]');
    if (mark && !marked) mark.remove();
    else if (!mark && marked) row.appendChild(L.paper.view.rowMark());
    play(row);
    L.ink.bullet.draw(sym.querySelector('.ink-bullet'));
  }

  /** A short pulse when the device can vibrate and the person turned feedback on (js/log/feel). Never required, never throws. */
  function buzz() {
    L.feel.feedback.cue('lock');
  }

  L.done.flip = { rowOf: rowOf, play: play, apply: apply, buzz: buzz };
})();
