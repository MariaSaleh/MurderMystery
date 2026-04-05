const CACHE_NAME = 'velvet-alibi-cache-v5';

const STATIC_ASSETS = [
    '/css/styles.css',
    '/img/favicon-32.png',
    '/img/favicon-16.png',
    '/manifest.json',
];

function isAppShellRequest(request, url) {
    if (request.method !== 'GET') {
        return false;
    }
    if (request.mode === 'navigate') {
        return true;
    }
    const path = url.pathname;
    return path === '/' || path === '/index.html' || path === '/app.js';
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                    return undefined;
                })
            )
        )
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    if (request.method !== 'GET') {
        event.respondWith(fetch(request));
        return;
    }

    if (isAppShellRequest(request, url)) {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => cached || fetch(request))
    );
});
