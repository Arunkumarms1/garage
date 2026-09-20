const CACHE_NAME = 'garageworkshop-v16';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  'https://cdn-icons-png.flaticon.com/512/1995/1995470.png'
];

// Install Event - cache the static application shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Caching app shell');
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  // Force active state immediately without waiting
  self.skipWaiting();
});

// Activate Event - clean up deprecated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  // Claim all active clients
  self.clients.claim();
});

// Fetch Event - implement robust Cache-First for assets, Network-First for API
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // If request is an API call, use Network-First strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone response and cache successful GET requests
          if (request.method === 'GET' && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // If offline and request is in cache, return it
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) return cachedResponse;
            // Otherwise return offline-friendly error JSON
            return new Response(
              JSON.stringify({ error: "You are offline, and this data is not cached." }),
              { headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
  } else {
    const isIndexHtml = url.pathname === '/' || url.pathname === '/index.html';

    if (isIndexHtml) {
      // Network-First for index.html: always try network, cache as fallback
      event.respondWith(
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            return caches.match(request).then((cachedResponse) => {
              if (cachedResponse) return cachedResponse;
              return caches.match('/');
            });
          })
      );
    } else {
      // Stale-While-Revalidate: serve cached instantly, update in background
      event.respondWith(
        caches.match(request).then((cachedResponse) => {
          const networkFetch = fetch(request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          }).catch(() => cachedResponse);

          return cachedResponse || networkFetch;
        })
      );
    }
  }
});
