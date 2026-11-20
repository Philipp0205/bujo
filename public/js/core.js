/*
 * Shared client helpers for bujo pages. Plain JS, no build step. Needs ak-dom.js (AppKit.h).
 *
 *   Bujo.request(method, path, body, { guarded })  JSON call. Resolves with the parsed body, rejects with an Error whose
 *                                                  message is safe to show. With guarded: true a 401 sends the person to /signin.
 *   Bujo.codePanel({ code, intro, buttonLabel, onDone })  The recovery code, shown once, with a copy button.
 */
(function () {
  'use strict';

  var h = AppKit.h;

  function request(method, path, body, options) {
    var guarded = !!(options && options.guarded);
    var init = { method: method, headers: { accept: 'application/json' }, credentials: 'same-origin' };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) {
        if (response.status === 401 && guarded) {
          window.location.replace('/signin');
          throw new Error('Signed out.');
        }
        if (!response.ok) {
          var error = new Error(json && json.error ? json.error : 'Something went wrong. Try again.');
          error.status = response.status;
          throw error;
        }
        return json;
      });
    });
  }

  /** Shows a message in a banner slot. Pass '' to clear it. */
  function say(slot, message, kind) {
    slot.replaceChildren();
    if (!message) return;
    slot.appendChild(h('div', { class: 'ak-banner', role: kind === 'ok' ? 'status' : 'alert', 'data-kind': kind || 'error' }, message));
  }

  function codePanel(options) {
    var copied = h('span', { class: 'bj-copied', role: 'status' });
    var copy = h('button', {
      type: 'button',
      class: 'ak-btn ak-btn-secondary',
      'data-action': 'copy-code',
      onclick: function () {
        AppKit.copyText(options.code).then(function (ok) {
          copied.textContent = ok ? 'Copied' : 'Could not copy. Select the code and copy it by hand.';
        });
      }
    }, 'Copy code');
    var done = h('button', {
      type: 'button',
      class: 'ak-btn ak-btn-accent',
      'data-action': 'code-saved',
      onclick: function () { options.onDone(); }
    }, options.buttonLabel || 'I saved it, continue');
    return h('section', { class: 'ak-card bj-code-panel', 'data-panel': 'recovery-code' },
      h('p', null, options.intro),
      h('p', { class: 'bj-code', id: 'bj-recovery-code', 'data-testid': 'recovery-code' }, options.code),
      h('p', { class: 'bj-note' }, 'This code is shown once. It is the only way back into your journal if you are signed out. Write it on paper or keep it in a password manager.'),
      h('div', { class: 'bj-actions' }, copy, done),
      copied
    );
  }

  window.Bujo = { request: request, say: say, codePanel: codePanel };
})();
