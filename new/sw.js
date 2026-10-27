/* Offline support: the app and its on-device helpers are kept after the first visit.
   Videos are never sent anywhere; this only stores the app's own files. */
const VERSION = 'n1-20261027a';
const SHELL = ['./', './index.html', './css/app.css', './manifest.webmanifest', './icon.svg', './icon-192.png',
  ...['app', 'util', 'store', 'model', 'media', 'defs', 'gl', 'compose', 'draw2d', 'sfx', 'audio', 'faces', 'track', 'playback', 'export', 'captions'].map(f => `./js/${f}.js`),
  ...['icons', 'widgets', 'state', 'actions', 'timeline', 'gizmo', 'editor', 'panels', 'panels2', 'panels-data', 'home'].map(f => `./js/ui/${f}.js`),
  './vendor/mp4-muxer.mjs'];
self.addEventListener('install', e => { e.waitUntil(caches.open('shell-' + VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('shell-') && x !== 'shell-' + VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || !url.protocol.startsWith('http')) return;
  const lib = url.origin === location.origin ? /\/vendor\//.test(url.pathname) : /cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|huggingface\.co/.test(url.host);
  if (lib) { e.respondWith(caches.open('lib-v1').then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; })); return; }
  if (url.origin === location.origin) e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => { const copy = r.clone(); caches.open('shell-' + VERSION).then(c => c.put(req, copy)); return r; }).catch(() => caches.match(req)));
});
