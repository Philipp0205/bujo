/*
 * The bottom tab bar (AppKit.tabbar) of the log, Notes and Settings pages. The kit does no routing, so a tap navigates here:
 * the log is the home, so a tab opened from it is pushed (Back returns to the log), a switch between Notes and Account replaces
 * the page (no stack of tabs), and a tap on Rapid log goes back in history when the log is the entry before.
 * Scan is an action, not a page: it never becomes the active tab. The log passes hooks.onScan to start the scan flow in place,
 * any other page goes to the log with ?scan=1, which starts the same flow there. Needs ak-tabbar.js, nav/copy.js and
 * nav/icons.js. Load nav/page-back.js first on a page that can be opened first in the window.
 */
(function () {
  'use strict';

  var N = window.BujoNav = window.BujoNav || {};

  var ORDER = ['log', 'notes', 'scan', 'account'];
  var PATHS = { log: '/', notes: '/notes', account: '/settings' };
  /** The log with this query starts the scan flow at boot (see log/main.js). */
  var SCAN_URL = '/?scan=1';
  /** Set while the history entry before the current page is the rapid log. Lives for the browser tab only. */
  var LOG_BEFORE = 'bujo-log-before';

  function remember(on) {
    try {
      if (on) window.sessionStorage.setItem(LOG_BEFORE, '1');
      else window.sessionStorage.removeItem(LOG_BEFORE);
    } catch (ignored) { /* private mode: the tab then replaces the page, which is still right */ }
  }

  function logIsBefore() {
    try { return window.sessionStorage.getItem(LOG_BEFORE) === '1'; } catch (ignored) { return false; }
  }

  /** The log was left by a tab (or page-back put a stub for the log under this page): the entry before this page is the log. */
  function noteHistory(active) {
    var state = window.history.state;
    if (active === 'log') remember(false);
    else if (state && state.bujoPage) remember(true);
  }

  /** Goes to the page of a tab, in the way that keeps Back short. */
  function go(from, to) {
    if (from === to) return;
    if (from === 'log') {
      remember(true);
      window.location.assign(PATHS[to]);
    } else if (to === 'log' && logIsBefore()) {
      remember(false);
      window.history.back();
    } else {
      window.location.replace(PATHS[to]);
    }
  }

  /** The tab definitions, with their words and icons. */
  function tabs() {
    return ORDER.map(function (id) { return { id: id, label: N.copy.tabs[id], icon: N.icons.icon(id) }; });
  }

  /** A tap on a tab: Scan starts the flow and returns (it is no route), any other tab goes to its page. */
  function select(active, id, hooks) {
    if (id !== 'scan') return go(active, id);
    if (hooks && hooks.onScan) hooks.onScan();
    else window.location.assign(SCAN_URL);
  }

  /** Adds the bar to the page with this tab marked active. hooks.onScan starts a scan on this page. Returns the kit's bar. */
  function mount(active, hooks) {
    noteHistory(active);
    var bar = AppKit.tabbar({
      tabs: tabs(),
      active: active,
      label: N.copy.barLabel,
      onSelect: function (id) { select(active, id, hooks); }
    });
    document.body.appendChild(bar.el);
    document.documentElement.classList.add('has-tabbar');
    return bar;
  }

  N.tabs = { mount: mount };
})();
