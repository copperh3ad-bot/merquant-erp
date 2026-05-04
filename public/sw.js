// public/sw.js — minimal offline-fallback service worker.
// Cache the app shell; on navigation requests serve fresh from network
// but fall back to the cached index.html if offline. Static assets
// fall through to the network (Vite hashed filenames keep this safe —
// stale hashed assets will 404 and trigger a reload).

const CACHE = "merquant-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/index.html"])));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
  }
});
