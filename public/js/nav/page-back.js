/*
 * Back on a page that was opened first in the window (the installed app started on Settings, the Backlog or Scan). History has
 * nothing before it, so Back would close the app. The entry is replaced by a stub that stands for the rapid log, and the page is
 * pushed on top: Back lands on the stub, which shows the log. A page reached by a link has history already and is left alone, so
 * Back there is one press. The log is shown in this document when the router has it (nav/router.js), else the window goes to it.
 * Only a script tag that runs while the page loads counts: the router adds this file later to a page that is not a first entry.
 */
(function () {
  'use strict';

  var HOME = '/';

  /** True when no page came before this one in the window. */
  function isFirstEntry() {
    return window.history.length <= 1;
  }

  /** Puts a stub for the log under the current page. The page keeps its own address. */
  function placeStub() {
    var here = window.location.pathname + window.location.search + window.location.hash;
    window.history.replaceState({ bujoStub: true }, '', HOME);
    window.history.pushState({ bujoPage: true }, '', here);
  }

  /** Back that lands on the stub leaves for the log. The stub entry is replaced, so no extra entry is left behind. */
  function leaveStub(event) {
    if (!event.state || !event.state.bujoStub) return;
    var router = window.BujoNav && window.BujoNav.router;
    if (!(router && router.leaveStub())) window.location.replace(HOME);
  }

  if (document.readyState !== 'loading') return;
  if (!window.history || typeof window.history.pushState !== 'function') return;
  if (isFirstEntry()) placeStub();
  window.addEventListener('popstate', leaveStub);
})();
