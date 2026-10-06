// Offline support. App code is network-first, so a new release shows up on the
// next launch while online; the cache is only used when the network is down.
// pdf.js files are big and only change with the version, so they are cache-first.
// PDFs never go through here; they are read straight from the user's disk.
const VERSION = new URL(location.href).searchParams.get("v") || "dev";
const CACHE = `df-${VERSION}`;
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
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const vendor = url.pathname.includes("/vendor/");
  e.respondWith(vendor ? cacheFirst(e.request) : networkFirst(e.request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    // no-cache: revalidate with the server instead of trusting the HTTP cache.
    const res = await withTimeout(fetch(request.url, { cache: "no-cache" }), NETWORK_TIMEOUT_MS);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw new Error(`offline and not cached: ${request.url}`);
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
