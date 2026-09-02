/* PROvision service worker.
   Bump CACHE when you change any file, or phones keep the old copy. */
const CACHE = "provision-v13";
const SHELL = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never touch the API. It must fail honestly when there is no signal.
  if (url.hostname.endsWith("anthropic.com")) return;

  // App files: serve from cache, refresh in the background.
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(hit => {
        const live = fetch(e.request)
          .then(res => {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || live;
      })
    );
    return;
  }

  // Fonts: cache once, then serve locally forever.
  if (url.hostname.includes("fonts.g")) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit))
    );
  }
});
