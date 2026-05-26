const CACHE_NAME = "gameframe-cache-v5";

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

// Network-first for HTML/navigation and JS so updates are not stuck behind cache.
// Cache-first for other assets.
self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  const accept = req.headers.get("accept") || "";
  const isHtml = req.mode === "navigate" || accept.includes("text/html");

  if (req.method !== "GET") {
    event.respondWith(
      fetch(req).catch(() =>
        new Response(JSON.stringify({ error: "Network request failed." }), {
          status: 503,
          headers: { "Content-Type": "application/json" }
        })
      )
    );
    return;
  }

  if (isHtml || url.pathname.startsWith("/static/js/")) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      return cached || fetch(req).catch(() => new Response("Offline", { status: 503, statusText: "Offline" }));
    })
  );
});
