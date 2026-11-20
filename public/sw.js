// Service worker. The logic is app-kit's ak-sw.js. This file only sets bujo's options.
// Bump `version` whenever a file in `shell` changes.
// Pages that need a sign-in are cached by their file name, not by "/" or "/settings": those paths redirect when
// signed out, and a redirect must never be stored as the page. Registered only from signed-in pages.
importScripts('/app-kit/ak-sw.js');
AppKitSW.setup({
  version: 'v4',
  prefix: 'bujo',
  shell: [
    '/index.html',
    '/settings.html',
    '/scan.html',
    '/css/styles.css',
    '/js/core.js',
    '/js/app.js',
    '/js/settings.js',
    '/js/scan.js',
    '/manifest.webmanifest?v=1',
    '/icons/icon-192.png',
    '/app-kit/ak-tokens.css',
    '/app-kit/ak-base.css',
    '/app-kit/ak-components.css',
    '/app-kit/ak-native.css',
    '/app-kit/install-prompt.css',
    '/app-kit/theme-color.js',
    '/app-kit/ak-dom.js',
    '/app-kit/ak-toast.js',
    '/app-kit/ak-native.js',
    '/app-kit/install-prompt.js',
    '/app-kit/ak-sw-register.js'
  ],
  networkOnly: ['/api/', '/mcp', '/healthz', '/signin', '/signup', '/lost', '/verify', '/recover', '/auth.html', '/js/auth.js'],
  offlineFallback: '/index.html'
});
