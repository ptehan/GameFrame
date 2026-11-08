const CACHE_NAME = "gameframe-cache-v9-local-libraries";
const HEAVY_ASSET = /^\/static\/(?:js\/ffmpeg\/|vendor\/(?:leaflet-1\.9\.4|html2canvas-1\.4\.1)\/)/;

self.addEventListener("install", event => {
  // Never delay an app update by downloading the video-processing runtime.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const current = await caches.open(CACHE_NAME);
    for (const name of await caches.keys()) {
      if (!name.startsWith("gameframe-cache-") || name === CACHE_NAME) continue;
      const old = await caches.open(name);
      for (const request of await old.keys()) {
        const url = new URL(request.url);
        if (url.origin === self.location.origin && HEAVY_ASSET.test(url.pathname)) {
          const response = await old.match(request);
          if (response && !(await current.match(request))) await current.put(request, response);
        }
      }
      await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  const url = new URL(req.url);
  // Maps, API results, and video ranges keep their own loading policies.
  if (url.origin !== self.location.origin || req.method !== "GET" ||
      url.pathname.startsWith("/api/") || url.pathname.startsWith("/stream/")) return;
  const isCode = req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html") ||
    ["script", "style", "document"].includes(req.destination) ||
    /\.(?:html|js|mjs|css)$/.test(url.pathname);
  if (HEAVY_ASSET.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      const response = await fetch(req);
      if (response.ok) await cache.put(req, response.clone());
      return response;
    })());
  } else if (isCode) {
    // No cached-code fallback: an unavailable server must not look like an old app.
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() =>
      new Response("GameFrame server is unavailable. Reconnect and refresh.", {
        status: 503, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" }
      })));
  }
});
