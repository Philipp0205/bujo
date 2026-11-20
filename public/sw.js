// Service worker. The logic is app-kit's ak-sw.js. This file only sets bujo's options.
// Bump `version` whenever a file in `shell` changes.
importScripts('/app-kit/ak-sw.js');
AppKitSW.setup({
  version: 'v1',
  prefix: 'bujo',
  shell: [
    '/',
    '/css/styles.css',
    '/js/app.js',
    '/manifest.webmanifest?v=1',
    '/icons/icon-192.png',
    '/app-kit/ak-tokens.css',
    '/app-kit/ak-base.css',
    '/app-kit/ak-components.css',
    '/app-kit/ak-native.css',
    '/app-kit/install-prompt.css',
    '/app-kit/theme-color.js',
    '/app-kit/ak-dom.js',
    '/app-kit/ak-native.js',
    '/app-kit/install-prompt.js',
    '/app-kit/ak-sw-register.js'
  ],
  networkOnly: ['/api/', '/healthz'],
  offlineFallback: '/'
});
