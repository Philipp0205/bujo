/*
 * What's new catalog: fetches /whats-new.json and lets the kit drop bad entries. Needs ak-whats-new.js.
 * A missing or broken file gives an empty list, so the page never fails because of it.
 */
(function () {
  'use strict';

  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};

  /** Resolves with the normalized entries, newest first. Never rejects. */
  function load() {
    return fetch('/whats-new.json', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (response) { return response.ok ? response.json() : []; })
      .then(function (json) { return AppKit.whatsNew.normalizeEntries(json); })
      .catch(function () { return []; });
  }

  W.catalog = { load: load };
})();
