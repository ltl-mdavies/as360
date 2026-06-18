const CACHE_VERSION = "adspace360-static-v2";
const APP_SHELL_CACHE = CACHE_VERSION;

const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/site.webmanifest",
  "/adspace-favicon.svg",
  "/adspace360-app-icon.svg",
  "/as360-favicon.png",
  "/apple-touch-icon.png",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/pwa-maskable-512.png"
];

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isSensitiveOrDynamicPath(pathname) {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/logout") ||
    pathname.includes("share=")
  );
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/assets/") ||
    pathname.endsWith(".css") ||
    pathname.endsWith(".js") ||
    pathname.endsWith(".mjs") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".webmanifest")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== APP_SHELL_CACHE)
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!isSameOrigin(url) || isSensitiveOrDynamicPath(url.pathname + url.search)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseCopy = response.clone();
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put("/index.html", responseCopy));
          return response;
        })
        .catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const responseCopy = response.clone();
            caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, responseCopy));
          }
          return response;
        });
      })
    );
  }
});
