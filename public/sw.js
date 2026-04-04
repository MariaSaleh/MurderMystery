const CACHE_NAME = 'velvet-alibi-cache-v1';
const urlsToCache = [
  '/',
  '/css/styles.css',
  '/app.js',
  '/socket.io/socket.io.js',
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,600;1,500&family=Outfit:wght@300;400;500;600&display=swap',
  'https://fonts.gstatic.com/s/cormorantgaramond/v16/co3esdO5o_95o_LA3N-sI0C_u43-CoK272jpxA.woff2',
  'https://fonts.gstatic.com/s/outfit/v6/QGYvz_MVcBeNP4NJtEtq.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        return fetch(event.request);
      })
  );
});
