// Offline support: serve the app from cache, refresh the cache in the background.
// PDFs never go through here; they are read straight from the user's disk.
const CACHE = "df-v2";
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "main.js",
  "viewer.js",
  "outline.js",
  "page-layers.js",
  "i18n.js",
  "file-range-transport.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "vendor/pdf.min.mjs",
  "vendor/pdf.worker.min.mjs",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate for same-origin GETs (cmaps and fonts get cached on first use).
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      if (cached) {
        e.waitUntil(fresh);
        return cached;
      }
      return fresh;
    }),
  );
});
