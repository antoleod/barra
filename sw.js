﻿const CACHE = "barra-scanner-v17-force-refresh";
const CORE = [
  "./",
  "./index.html",
  "./login.html",
  "./styles.css",
  "./app.js",
  "./login.js",
  "./firebase-service.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "https://unpkg.com/html5-qrcode",
  // Cachear los módulos de Firebase desde el CDN
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.allSettled(
        CORE.map(async (url) => {
          try {
            await cache.add(url);
          } catch (error) {
            // Keep SW install resilient in offline mode or non-Firebase local servers.
            console.warn("[sw] cache add failed:", url, error);
          }
        })
      );
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached ||
      fetch(event.request)
        .then((res) => {
          // Only cache same-origin requests or known CDN files from CORE
          const url = new URL(event.request.url);
          const isSameOrigin = url.origin === self.location.origin;
          const isCoreCdn = CORE.some((c) => c.startsWith("http") && url.href.startsWith(c));
          if (isSameOrigin || isCoreCdn) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            const url = new URL(event.request.url);
            const fallback = url.pathname.includes("login") ? "./login.html" : "./index.html";
            return caches.match(fallback);
          }
          return Response.error();
        })
    )
  );
});
