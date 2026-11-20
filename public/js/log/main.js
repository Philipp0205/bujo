/*
 * Boots the rapid log: loads the window of days, renders it, and wires the sheet. Needs every other log file and core.js.
 * The state lives here and nowhere else.
 */
(function () {
  'use strict';

  var L = window.BujoLog = window.BujoLog || {};
  var root = document.getElementById('log');
  var state = { status: 'loading', entries: [], today: L.dates.todayIso(), focus: null };

  /** The things a row or the add row can do. */
  var actions = {
    open: function (entry) { L.sheet.open({ entry: entry, today: state.today, onSaved: reload }); },
    add: function () { L.sheet.open({ entry: null, today: state.today, onSaved: reload }); },
    scan: function () { L.scan.flow.start({ day: state.today, onApplied: applied }); }
  };

  /** After a scan is applied: show the day it landed on, even when it is outside the usual window. */
  function applied(result) {
    state.focus = result.date;
    reload();
  }

  /** The body under the header for the current status. */
  function body() {
    if (state.status === 'ready') return L.view.dayList(state.entries, state.today, actions);
    return L.view.stateNote(state.status, reload);
  }

  /** Redraws the whole page from the state. The page is small, so nothing is patched in place. */
  function render() {
    root.replaceChildren(L.view.header(actions.scan), AppKit.h('div', { class: 'paper-page' }, body()));
  }

  /** Loads the window around today, stretched to the day of the last applied scan. A failed load keeps the entries on screen. */
  function load() {
    state.today = L.dates.todayIso();
    var range = L.dates.windowWith(state.today, state.focus);
    return L.api.list(range.from, range.to).then(function (entries) {
      state.entries = entries;
      state.status = 'ready';
    }, function () {
      state.status = 'error';
    }).then(render);
  }

  function reload() {
    state.status = 'loading';
    render();
    return load();
  }

  AppKit.themeColor.start();
  AppKit.installPrompt.init({ appName: 'bujo', iconUrl: '/icons/icon-192.png' });
  AppKit.sw.register({ url: '/sw.js', scope: '/' });

  render();
  load();
})();
