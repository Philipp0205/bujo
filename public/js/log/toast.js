/*
 * The paper toast: one short line over the page ("Copied 3"), like a slip of paper. It sits above the tab bar, or above the
 * edit sheet while that is open, and leaves by itself. It never takes a tap. Needs ak-dom.js. Not the kit's toast, which wears the kit surface.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var L = window.BujoLog = window.BujoLog || {};

  var SHOW_MS = 2200;
  var GAP_PX = 12;
  var node = null;
  var timer = null;

  /** Removes the toast on screen, if any. */
  function hide() {
    window.clearTimeout(timer);
    if (node) node.remove();
    node = null;
  }

  /** Lifts the toast over the edit sheet when one is open; otherwise the CSS keeps it above the tab bar. */
  function lift(toast) {
    var sheet = document.querySelector('.edit-sheet:not([hidden])');
    if (sheet) toast.style.bottom = (window.innerHeight - sheet.getBoundingClientRect().top + GAP_PX) + 'px';
  }

  /** Shows a line of text for a moment. kind is 'ok' (a status) or 'fail' (an alert). It replaces the toast already there. */
  function show(text, kind) {
    hide();
    var ok = kind !== 'fail';
    node = h('div', {
      class: 'paper-toast',
      role: ok ? 'status' : 'alert',
      'data-testid': ok ? 'copied-toast' : 'copy-failed-toast'
    }, text);
    document.body.appendChild(node);
    lift(node);
    timer = window.setTimeout(hide, SHOW_MS);
  }

  L.toast = { show: show };
})();
