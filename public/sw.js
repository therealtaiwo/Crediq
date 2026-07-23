// CrediQ service worker
// Required for Chrome/Android to fire `beforeinstallprompt` — without an
// active SW with a real (non-empty) fetch handler, the install prompt never appears.
// Strategy: network-first for page navigations (so a fast-moving app always
// ships the latest deploy), cache-first for static same-origin assets,
// with an offline fallback. API calls and cross-origin requests pass straight through.
//
// IMPORTANT: bump CACHE_NAME on every deploy (v1 -> v2 -> v3...). It's the
// only thing that makes the activate-time cleanup below actually delete the
// previous version's cache instead of just keeping the same bucket forever.
const CACHE_NAME = "crediq-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests. Leave API calls (e.g. /api/verify-payment,
  // /api/webhook), Firebase, Paystack, and any cross-origin request untouched.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: try the network first so users always get the latest
  // deploy; fall back to the cached shell if offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match("/")))
    );
    return;
  }

  // Static assets (JS/CSS/images/fonts): cache-first, then network,
  // caching whatever comes back for next time.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
