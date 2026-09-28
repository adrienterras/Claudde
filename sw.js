// Service worker : l'application s'ouvre même sans réseau.
const CACHE = 'tiebreak-v2';
const SHELL = [
    './', 'index.html', 'style.css', 'app.js', 'store.js', 'stats.js',
    'firebase-config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

// Réseau d'abord pour avoir la dernière version, cache en secours.
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== location.origin) return;
    event.respondWith(
        fetch(event.request)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(event.request, copy));
                return res;
            })
            .catch(() => caches.match(event.request, { ignoreSearch: true })),
    );
});
