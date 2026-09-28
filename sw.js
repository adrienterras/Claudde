// Service worker : l'application s'ouvre et fonctionne même sans réseau.
const CACHE = 'tiebreak-v5';
const SHELL = [
    './', 'index.html', 'style.css', 'app.js', 'store.js', 'stats.js',
    'firebase-config.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
];
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const SDK_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(f => FIREBASE_SDK + f);

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(SHELL).then(() => c.addAll(SDK_FILES).catch(() => {})))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

// Fichiers qui ne changent jamais pour une version donnée : bibliothèque
// Firebase (version fixée dans l'adresse) et polices.
function isImmutable(url) {
    return url.href.startsWith(FIREBASE_SDK)
        || url.hostname === 'fonts.gstatic.com'
        || url.hostname === 'fonts.googleapis.com';
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    // Cache d'abord pour la bibliothèque Firebase et les polices.
    if (isImmutable(url)) {
        event.respondWith(
            caches.match(request).then(hit => hit || fetch(request).then(res => {
                if (res.ok || res.type === 'opaque') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(request, copy));
                }
                return res;
            })),
        );
        return;
    }

    if (url.origin !== location.origin) return;

    // Réseau d'abord pour avoir la dernière version, cache en secours.
    event.respondWith(
        fetch(request)
            .then(res => {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(request, copy));
                return res;
            })
            .catch(() => caches.match(request, { ignoreSearch: true })
                .then(hit => hit || caches.match('index.html'))),
    );
});
