const CACHE = "barra-scanner-v7-firebase-hosting";
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
  // Cachear los SDK de Firebase y el script de inicialización
  "/__/firebase/10.7.1/firebase-app.js",
  "/__/firebase/10.7.1/firebase-auth.js",
  "/__/firebase/10.7.1/firebase-firestore.js",
  "/__/firebase/init.js",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
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
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => {
          if (event.request.mode === "navigate") return caches.match("./index.html");
          return undefined;
        })
    )
  );
});
