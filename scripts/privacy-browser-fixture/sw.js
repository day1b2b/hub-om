/* global self, caches, fetch */
// Test-origin shell only. No API responses, draft plaintext, authentication or app pages cached.
const VERSION = 3;
// A separate candidate cache makes an injected failed install safe even with v3 active.
const FAILURE_PROBE = new URL(self.location.href).searchParams.get("fixture-install") === "fail";
const CACHE = FAILURE_PROBE ? "pii-fixture-shell-v3-failed-candidate" : "pii-fixture-shell-v3";
const ASSETS = ["/", "/index.html", "/harness.js", "/modules/browserDraftCrypto.js", "/modules/browserDraftStore.js"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(path => new Request(path, { cache: "reload" })));
    if (FAILURE_PROBE) {
      // Failure after caching but before activation exercises the update boundary.
      await caches.delete(CACHE);
      throw new Error("Synthetic fixture installation failure.");
    }
    await self.skipWaiting();
  })());
});
// Retain prior-version caches for explicit rollback checks in this isolated origin.
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("message", event => {
  if (event.data?.type !== "fixture-shell-status" || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const complete = (await Promise.all(ASSETS.map(path => cache.match(path)))).every(Boolean);
      event.ports[0].postMessage({ version: VERSION, cacheName: CACHE, complete, assets: ASSETS });
    } catch { event.ports[0].postMessage({ version: VERSION, complete: false }); }
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET" || !ASSETS.includes(url.pathname)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) ?? fetch(event.request)));
});
