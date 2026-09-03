/* PROvision service worker.
   Bump CACHE here and VERSION in index.html together, to the same number. */
const CACHE = "provision-v23";
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

/* Network first, cache as the fallback. This used to be the other way round —
   serve the cache, refresh behind it — which meant every deploy needed the app
   opened twice before the new build appeared, and the home screen app keeps its
   own registration separate from Safari, so it could sit a version behind for
   days. The boat has Starlink; a couple of seconds waiting for the network is a
   better trade than not knowing which build is running.

   The cache still does its job the moment the network is missing or slow. */
const TIMEOUT = 4000;

function fresh(request) {
  return new Promise((resolve, reject) => {
    const bail = setTimeout(() => reject(new Error("slow")), TIMEOUT);
    fetch(request).then(res => { clearTimeout(bail); resolve(res); },
                        err => { clearTimeout(bail); reject(err); });
  });
}

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Never touch the API. It must fail honestly when there is no signal.
  if (url.hostname.endsWith("anthropic.com")) return;

  if (url.origin === location.origin) {
    e.respondWith(
      fresh(e.request)
        .then(res => {
          /* Only cache what came back whole — a 404 or an opaque error stored
             here would outlive the mistake that caused it. */
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(hit =>
          hit || new Response("Offline and not cached.", { status: 503, headers: { "content-type": "text/plain" } })
        ))
    );
    return;
  }

  // Fonts never change under the same URL: cache once, serve locally forever.
  if (url.hostname.includes("fonts.g")) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
        return res;
      }).catch(() => hit))
    );
  }
});
