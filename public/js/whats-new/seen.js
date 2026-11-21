/*
 * What's new seen state: the newest entry id the person has seen, kept on this device (localStorage) and on the account
 * (/api/whats-new/seen). The two are merged with AppKit.whatsNew.newerSeen, so a second device does not replay old entries.
 * Needs ak-whats-new.js and core.js. A failed storage or network call never breaks the page: it counts as nothing seen there.
 */
(function () {
  'use strict';

  var W = window.BujoWhatsNew = window.BujoWhatsNew || {};
  var KEY = 'bujo-whats-new-seen';
  var URL = '/api/whats-new/seen';

  /** The seen id kept on this device, or '' when there is none or storage is blocked. */
  function readLocal() {
    try { return window.localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  /** Keeps the seen id on this device. Blocked storage is ignored. */
  function writeLocal(id) {
    try { window.localStorage.setItem(KEY, id); } catch (e) { /* the account copy still holds it */ }
  }

  /** The seen id on the account, or '' when it is empty or the call fails. */
  function readAccount() {
    return Bujo.request('GET', URL).then(function (result) { return (result && result.seen) || ''; }, function () { return ''; });
  }

  /** Stores the seen id on the account. Resolves true or false, never rejects. */
  function writeAccount(id) {
    return Bujo.request('PUT', URL, { id: id }).then(function () { return true; }, function () { return false; });
  }

  /** The newer of the device id and the account id, judged against the catalog. '' means nothing seen. */
  function current(entries) {
    return readAccount().then(function (account) {
      return AppKit.whatsNew.newerSeen(readLocal(), account, entries) || '';
    });
  }

  /** Marks an id as seen on this device and on the account. An id the kit rejects is ignored. */
  function remember(id) {
    if (!AppKit.whatsNew.validId(id)) return Promise.resolve(false);
    writeLocal(id);
    return writeAccount(id);
  }

  W.seen = { current: current, remember: remember, readLocal: readLocal };
})();
