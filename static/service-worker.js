const CACHE_NAME = "gameframe-cache-v3";

// Files we WANT to cache, but will NEVER crash install if missing
const ASSETS = [
  "/static/css/styles.css",
  "/static/js/ffmpeg/ffmpeg-core.js",
  "/static/js/ffmpeg/ffmpeg-core.worker.js",
  "/manifest.json"
];

self.addEventListener("install", event => {
  // Install should NEVER fail
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const url of ASSETS) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            await cache.put(url, res.clone());
          } else {
            console.warn("Skipping (bad status):", url, res.status);
          }
        } catch (err) {
          console.warn("Skipping (fetch error):", url, err);
        }
      }
    })
  );

  // Force new SW to activate immediately
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      )
    )
  );
  self.clients.claim();
});

// Cache-first for static, network-first for everything else
self.addEventListener("fetch", event => {
  const req = event.request;

  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req).catch(() => cached);
    })
  );
});
