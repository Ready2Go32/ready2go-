const CACHE = "ready2go-v21";
const APP_FILES = [
  "./", "./index.html", "./style.css", "./storage.js", "./garbage.js", "./municipal-garbage-data.js",
  "./settings.js", "./weather.js", "./calendar.js", "./dashboard.js", "./features.js",
  "./script.js", "./garbage-calendar.html", "./liff-init.html",
  "./privacy.html", "./terms.html",
  "./manifest.json", "./app-icon.svg", "./icon-192.png", "./icon-512.png"
];
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(APP_FILES)).then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || ["/health", "/webhook", "/app-config.js"].includes(url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy));
    }
    return response;
  }).catch(async () => {
    const hit = await caches.match(event.request);
    if (hit) return hit;
    if (event.request.mode === "navigate") {
      const page = await caches.match(url.pathname);
      return page || caches.match("./index.html");
    }
    return Response.error();
  }));
});
