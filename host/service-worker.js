/* Only public installation/offline assets belong in this cache. Never cache
 * game state, RPC, wallet traffic, authenticated requests or game bundles. */
const CACHE = "farfield-offline-__BUILD__";
const FILES = [
  "/offline.html",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  // No skipWaiting: updates must not take over a match in another open window.
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("farfield-offline-") && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("Authorization")
  )
    return;
  const navigation =
    request.mode === "navigate" && ["/", "/index.html"].includes(url.pathname);
  if (!navigation && !FILES.includes(url.pathname)) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (
          (await cache.match(navigation ? "/offline.html" : url.pathname)) ||
          Response.error()
        );
      }
    })(),
  );
});
