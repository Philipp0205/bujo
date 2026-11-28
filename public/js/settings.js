/*
 * bujo settings: account email, theme, agent tokens, what's new, sign out. Plain JS, no build step.
 * A token is shown once, right after it is created. Only its prefix is listed afterwards.
 * The page registers with BujoNav.router, which shows it on a cold load of /settings and again whenever the Account tab is
 * tapped (the page stays in the document, hidden, while another tab is on screen). The account is read through AppKit.swr.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var app = document.getElementById('app');
  var state = { me: null, tokens: [], fresh: null, confirming: null, scope: 'read', error: null, mailNote: null };
  var booted = false;

  function req(method, path, body) {
    return Bujo.request(method, path, body, { guarded: true });
  }

  /** The account and its tokens in one read, the shape that is cached. */
  function fetchAccount() {
    return Promise.all([req('GET', '/api/auth/me'), req('GET', '/api/tokens')]).then(function (results) {
      return { me: results[0], tokens: results[1].tokens };
    });
  }

  /** Takes a read of the account. The page is only drawn again when it differs from what is on screen. */
  function accept(data) {
    var same = !state.error && !!state.me && JSON.stringify({ me: state.me, tokens: state.tokens }) === JSON.stringify(data);
    state.me = data.me;
    state.tokens = data.tokens;
    state.error = null;
    if (!same) render();
  }

  /** A failed read keeps the page that is on screen, and shows the error only when there is none. */
  function failed(error) {
    if (state.me) return;
    state.error = error.message;
    render();
  }

  /** Reads the account through the cache: the last read is drawn at once, the fresh one replaces it only when it changed. */
  function loadCached() {
    var stale = function (data) { if (!state.me) accept(data); };
    return BujoNav.data.load(BujoNav.data.KEYS.settings, fetchAccount, { stale: stale, fresh: accept, fail: failed });
  }

  /** Reads the account after a change (a token made or revoked): the server alone, so the list cannot be an older shared read. */
  function load() {
    return BujoNav.data.fresh(BujoNav.data.KEYS.settings, fetchAccount).then(accept, failed);
  }

  function formatTime(ms) {
    if (!ms) return 'never';
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------- email ---------- */

  function emailSection() {
    var me = state.me;
    var slot = h('div', { class: 'bj-slot' });
    var input = h('input', { class: 'ak-input', id: 'email', type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false', value: me.user.email || '' });
    var status = !me.user.email ? 'No email yet.' : me.user.emailVerifiedAt ? 'Confirmed.' : 'Not confirmed yet.';
    if (!me.emailEnabled) status += ' Email sending is off on this server, so no link can be sent.';
    var resend = null;
    if (me.user.email && !me.user.emailVerifiedAt && me.emailEnabled) {
      resend = h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', 'data-action': 'resend-confirmation', onclick: function () {
        // The saved address, not whatever is typed in the field right now.
        var saved = me.user.email;
        resend.disabled = true;
        req('POST', '/api/auth/email', { email: saved }).then(function (result) {
          state.me.user = result.user;
          state.mailNote = 'Confirmation link sent to ' + saved + '.';
          render();
        }).catch(function (error) {
          resend.disabled = false;
          Bujo.say(slot, error.message);
        });
      } }, 'Send confirmation link again');
    }
    var form = h('form', { class: 'bj-form', novalidate: true, onsubmit: function (event) {
      event.preventDefault();
      req('POST', '/api/auth/email', { email: input.value }).then(function (result) {
        state.me.user = result.user;
        state.mailNote = 'Saved. Check your inbox for a confirm link.';
        render();
      }).catch(function (error) { Bujo.say(slot, error.message); });
    } },
      h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'email' }, 'Email'), input),
      h('p', { class: 'bj-note', 'data-testid': 'email-status' }, status),
      slot,
      h('button', { type: 'submit', class: 'ak-btn ak-btn-secondary' }, 'Save email'),
      resend);
    if (state.mailNote) Bujo.say(slot, state.mailNote, 'ok');
    return h('section', { class: 'bj-section' }, h('h2', { class: 'bj-group-title' }, 'Account'), h('div', { class: 'bj-card', 'data-card': 'account' }, form));
  }

  /* ---------- tokens ---------- */

  function freshPanel() {
    if (!state.fresh) return null;
    var copied = h('span', { class: 'bj-copied', role: 'status' });
    return h('div', { class: 'bj-card bj-code-panel', 'data-panel': 'new-token' },
      h('p', null, 'Token for ' + state.fresh.name + ' (' + state.fresh.scope + '). Copy it now. It is not shown again.'),
      h('p', { class: 'bj-code', 'data-testid': 'new-token' }, state.fresh.token),
      h('div', { class: 'bj-actions' },
        h('button', { type: 'button', class: 'ak-btn ak-btn-accent', 'data-action': 'copy-token', onclick: function () {
          AppKit.copyText(state.fresh.token).then(function (ok) {
            copied.textContent = ok ? 'Copied' : 'Could not copy. Select the token and copy it by hand.';
          });
        } }, 'Copy token'),
        h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', 'data-action': 'dismiss-token', onclick: function () {
          state.fresh = null;
          render();
        } }, 'Done')),
      copied);
  }

  function tokenRow(token) {
    var sure = state.confirming === token.id;
    var actions = sure
      ? [
        h('button', { type: 'button', class: 'ak-btn ak-btn-danger', 'data-action': 'confirm-revoke', onclick: function () {
          req('POST', '/api/tokens/' + encodeURIComponent(token.id) + '/revoke').then(function () {
            state.confirming = null;
            AppKit.toast('Token revoked');
            return load();
          }).catch(function (error) { AppKit.toast(error.message, { kind: 'error' }); });
        } }, 'Revoke'),
        h('button', { type: 'button', class: 'ak-btn ak-btn-text', 'data-action': 'cancel-revoke', onclick: function () {
          state.confirming = null;
          render();
        } }, 'Keep')
      ]
      : [h('button', { type: 'button', class: 'ak-btn ak-btn-text', 'data-action': 'revoke', 'aria-label': 'Revoke ' + token.name, onclick: function () {
        state.confirming = token.id;
        render();
      } }, 'Revoke')];
    return h('li', { class: 'ak-row', 'data-token-id': token.id },
      h('div', { class: 'ak-row-grow' },
        h('p', { class: 'ak-row-title' }, token.name),
        h('p', { class: 'ak-row-sub' }, token.tokenPrefix + '... , ' + token.scope + ', last used ' + formatTime(token.lastUsedAt))),
      h('div', { class: 'bj-actions' }, actions));
  }

  function tokenSection() {
    var slot = h('div', { class: 'bj-slot' });
    var name = h('input', { class: 'ak-input', id: 'token-name', type: 'text', maxlength: '40', placeholder: 'For example: Claude' });
    var segment = h('div', { class: 'ak-segment', role: 'group', 'aria-label': 'Scope' }, ['read', 'write'].map(function (scope) {
      var on = state.scope === scope;
      return h('button', { type: 'button', class: 'ak-segment-btn' + (on ? ' ak-on' : ''), 'aria-pressed': on ? 'true' : 'false', 'data-scope': scope, onclick: function () {
        state.scope = scope;
        state.nameDraft = name.value;
        render();
      } }, scope === 'read' ? 'Read only' : 'Read and write');
    }));
    if (state.nameDraft) name.value = state.nameDraft;
    var form = h('form', { class: 'bj-form', novalidate: true, onsubmit: function (event) {
      event.preventDefault();
      req('POST', '/api/tokens', { name: name.value, scope: state.scope }).then(function (result) {
        state.fresh = { token: result.token, name: result.info.name, scope: result.info.scope };
        state.nameDraft = '';
        return load();
      }).catch(function (error) { Bujo.say(slot, error.message); });
    } },
      h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: 'token-name' }, 'Name'), name),
      h('div', { class: 'ak-field' }, h('span', { class: 'ak-label' }, 'Access'), segment),
      slot,
      h('button', { type: 'submit', class: 'ak-btn ak-btn-accent', 'data-action': 'create-token' }, 'Create token'));

    var list = state.tokens.length
      ? h('ul', { class: 'bj-list ak-list', 'data-list': 'tokens' }, state.tokens.map(tokenRow))
      : h('div', { class: 'ak-empty', 'data-state': 'no-tokens' }, 'No agent tokens yet.');

    return h('section', { class: 'bj-section' },
      h('h2', { class: 'bj-group-title' }, 'Agent tokens'),
      h('p', { class: 'bj-note' }, 'A token lets a script or an AI agent use /api/v1 and /mcp. A read token cannot change anything. A token can never manage tokens.'),
      freshPanel(),
      h('div', { class: 'bj-card', 'data-card': 'new-token-form' }, form),
      list);
  }

  function signOut() {
    return h('section', { class: 'bj-section' },
      h('button', { type: 'button', class: 'ak-btn ak-btn-secondary', 'data-action': 'sign-out', onclick: function () {
        req('POST', '/api/auth/logout').then(function () { BujoNav.data.clear(); window.location.assign('/signin'); })
          .catch(function (error) { AppKit.toast(error.message, { kind: 'error' }); });
      } }, 'Sign out'));
  }

  function render() {
    var title = h('div', { class: 'bj-head' }, h('h1', { class: 'ak-large-title' }, 'Settings'));
    if (!state.me) {
      var note = state.error ? h('div', { class: 'bj-state', role: 'alert' }, h('div', { class: 'ak-empty' }, state.error)) : null;
      app.replaceChildren.apply(app, [title, note].filter(Boolean));
      return;
    }
    var focus = document.activeElement && document.activeElement.id;
    app.replaceChildren.apply(app, [title, emailSection(), BujoTheme.section.section(), BujoFont.section.section(), BujoLog.feel.section.section(), tokenSection(), BujoWhatsNew.settingsRow.section(), signOut()].filter(Boolean));
    BujoLog.ink.decorate.screen(app);
    if (focus) { var again = document.getElementById(focus); if (again) again.focus(); }
  }

  /** The router shows Account: paints the cached account at once on the first show (else the title alone), then reads it quietly. */
  function show() {
    if (booted) return loadCached();
    booted = true;
    var reading = loadCached();
    if (!app.firstChild) render();
    return reading;
  }

  /** Reads the account into the cache while another tab is on screen, so the first switch here can paint it at once. */
  function warm() {
    return BujoNav.data.warm(BujoNav.data.KEYS.settings, fetchAccount);
  }

  BujoNav.router.start('account', { show: show, warm: warm });
})();
