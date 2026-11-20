/*
 * bujo sign-in pages: /signup, /signin, /lost, /verify, /recover. One file, one screen per path.
 * The links in mail carry their token in the fragment (#t=...). A page load never uses it; a tap on the button does.
 */
(function () {
  'use strict';

  var h = AppKit.h;
  var app = document.getElementById('app');
  var path = window.location.pathname.replace(/\/+$/, '') || '/';

  function field(id, label, attrs) {
    var input = h('input', Object.assign({ class: 'ak-input', id: id, name: id }, attrs));
    return { input: input, node: h('div', { class: 'ak-field' }, h('label', { class: 'ak-label', for: id }, label), input) };
  }

  function head(title, sub) {
    return h('div', { class: 'ak-screen-head' }, h('h1', { class: 'ak-screen-title' }, title), sub ? h('p', { class: 'bj-sub' }, sub) : null);
  }

  function link(href, text) {
    return h('p', { class: 'bj-note' }, h('a', { href: href }, text));
  }

  function show() {
    app.replaceChildren.apply(app, Array.prototype.slice.call(arguments).filter(Boolean));
  }

  /** A form with a banner slot. submit(setBusy) returns a Promise; its rejection shows in the banner. */
  function form(fields, label, submit) {
    var slot = h('div', { class: 'bj-slot' });
    var button = h('button', { type: 'submit', class: 'ak-btn ak-btn-accent' }, label);
    var node = h('form', { class: 'bj-form', novalidate: true, onsubmit: function (event) {
      event.preventDefault();
      Bujo.say(slot, '');
      button.disabled = true;
      Promise.resolve(submit()).catch(function (error) {
        Bujo.say(slot, error && error.message ? error.message : 'Something went wrong. Try again.');
      }).then(function () { button.disabled = false; });
    } }, fields.map(function (f) { return f.node; }), slot, button);
    return { node: node, slot: slot };
  }

  function fragmentToken() {
    var match = /(?:^#|&)t=([^&]+)/.exec(window.location.hash);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function forgetFragment() {
    window.history.replaceState(null, '', window.location.pathname);
  }

  function signup() {
    var name = field('name', 'Your name', { type: 'text', autocomplete: 'name', maxlength: '40', required: true });
    var email = field('email', 'Email', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true });
    var f = form([name, email], 'Create journal', function () {
      return Bujo.request('POST', '/api/auth/signup', { name: name.input.value, email: email.input.value }).then(function (result) {
        show(head('Save your recovery code'), Bujo.codePanel({
          code: result.recoveryCode,
          intro: 'Your journal is ready, ' + result.user.name + '. This is your recovery code:',
          onDone: function () { window.location.assign('/'); }
        }));
      });
    });
    show(
      head('Welcome to bujo', 'Create the one account for this journal.'),
      f.node,
      h('p', { class: 'bj-note' }, 'The first visitor claims the account. Do this right after you deploy, before you share the address.'),
      link('/signin', 'Already have an account? Sign in')
    );
  }

  function signin() {
    var code = field('code', 'Recovery code', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX', required: true });
    var f = form([code], 'Sign in', function () {
      return Bujo.request('POST', '/api/auth/login', { code: code.input.value }).then(function () { window.location.assign('/'); });
    });
    show(head('Sign in', 'Enter the recovery code you saved when you created the journal.'), f.node, link('/lost', 'Lost your code?'));
  }

  function lost() {
    var email = field('email', 'Email', { type: 'email', autocomplete: 'email', inputmode: 'email', required: true });
    var f = form([email], 'Send sign-in link', function () {
      return Bujo.request('POST', '/api/auth/lost-code', { email: email.input.value }).then(function () {
        Bujo.say(f.slot, 'If that address is confirmed on this journal, a sign-in link is on its way. It works once and expires in 20 minutes.', 'ok');
      });
    });
    show(head('Lost your code?', 'We can email a one-time sign-in link to the confirmed address.'), f.node, link('/signin', 'Back to sign in'));
  }

  function verify() {
    var token = fragmentToken();
    var slot = h('div', { class: 'bj-slot' });
    var button = h('button', {
      type: 'button',
      class: 'ak-btn ak-btn-accent',
      onclick: function () {
        button.disabled = true;
        Bujo.request('POST', '/api/auth/verify', { token: token }).then(function () {
          forgetFragment();
          button.hidden = true;
          Bujo.say(slot, 'Email confirmed.', 'ok');
        }).catch(function (error) {
          button.disabled = false;
          Bujo.say(slot, error.message);
        });
      }
    }, 'Confirm email');
    if (!token) {
      Bujo.say(slot, 'This link is incomplete. Open it again from the email.');
      button.hidden = true;
    }
    show(head('Confirm your email'), slot, button, link('/', 'Open bujo'));
  }

  function recover() {
    var token = fragmentToken();
    var slot = h('div', { class: 'bj-slot' });
    var button = h('button', {
      type: 'button',
      class: 'ak-btn ak-btn-accent',
      onclick: function () {
        button.disabled = true;
        Bujo.request('POST', '/api/auth/lost-code/consume', { token: token }).then(function (result) {
          forgetFragment();
          show(head('Signed in'), Bujo.codePanel({
            code: result.recoveryCode,
            intro: 'Your old recovery code no longer works. This is the new one:',
            onDone: function () { window.location.assign('/'); }
          }));
        }).catch(function (error) {
          button.disabled = false;
          Bujo.say(slot, error.message);
        });
      }
    }, 'Sign in');
    if (!token) {
      Bujo.say(slot, 'This link is incomplete. Open it again from the email.');
      button.hidden = true;
    }
    show(head('Sign in with your link', 'Other devices are signed out and you get a new recovery code.'), slot, button, link('/lost', 'Ask for a new link'));
  }

  var screens = { '/signup': signup, '/signin': signin, '/lost': lost, '/verify': verify, '/recover': recover };
  AppKit.themeColor.start();
  (screens[path] || signin)();
})();
