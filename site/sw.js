/* Service worker: makes the tracker an installable app that opens instantly and works offline.

   - App shell (pages, CSS, JS, Latin fonts, icons): precached at install, then served from the cache
     and refreshed in the background (stale-while-revalidate), so a deploy reaches the next visit
     even without a version bump.
   - Data (data/*.json, boundaries, 2022 results): stale-while-revalidate, so pages open instantly
     with the last data and the fresh copy is fetched behind them.
   - News (data/news.json): network first, falling back to the cached copy offline.
   - Photos and the other font subsets: cache first.
   - Other origins: only the pinned cdnjs libraries (Leaflet, Chart.js, html-to-image) are cached.
     Every other cross-origin request (and anything that looks like a login or auth page) passes
     straight through, uncached.

   Bump VERSION when the shell list changes or to make every installed copy refresh at once: the new
   worker precaches, the page offers "Update available, tap to refresh", and old caches are deleted
   when it activates. */
const VERSION = "v1";
const PREFIX = "vet-";
const CACHES = {
  shell: `${PREFIX}shell-${VERSION}`,
  data: `${PREFIX}data-${VERSION}`,
  media: `${PREFIX}media-${VERSION}`,
  libs: `${PREFIX}libs-${VERSION}`,
};
const LIMITS = { data: 160, media: 250, libs: 20 };   // entries; oldest go first

const SHELL = [
  "./", "index.html", "lower.html", "upper.html", "candidate.html", "pendulum.html", "poll.html",
  "timeline.html", "myseats.html", "about.html", "data/",
  "css/style.css",
  "js/common.js", "js/home.js", "js/lower.js", "js/upper.js", "js/candidate.js", "js/pendulum.js",
  "js/poll.js", "js/timeline.js", "js/myseats.js", "js/datafiles.js", "js/maps.js", "js/sharecard.js",
  "js/htv.js", "js/quota.js",
  "fonts/inter-latin.woff2", "fonts/archivo-latin.woff2",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
  "manifest.webmanifest",
];
const LIB_HOSTS = ["cdnjs.cloudflare.com"];
const NEVER = /\/(login|logout|signin|sign-in|signup|auth|oauth|account)(\/|$|\?)/i;
const BASE = new URL("./", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHES.shell).then((cache) =>
    cache.addAll(SHELL.map((path) => new Request(new URL(path, BASE), { cache: "reload" })))));
  // No skipWaiting here: an update waits until the page's "tap to refresh" (or every tab closes).
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set(Object.values(CACHES));
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && !keep.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

const cacheable = (res) => res && res.ok && (res.type === "basic" || res.type === "cors");

async function put(cacheName, request, response) {
  if (!cacheable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
  const key = Object.keys(CACHES).find((k) => CACHES[k] === cacheName);
  if (LIMITS[key]) await trim(cacheName, LIMITS[key]);
}

// Serve the cached copy at once (if any) and refresh it in the background.
async function staleWhileRevalidate(event, cacheName, fallback) {
  const { request } = event;
  const cached = await caches.match(request, { ignoreSearch: false });
  const network = fetch(request).then((res) => {
    event.waitUntil(put(cacheName, request, res.clone()));
    return res;
  }).catch(() => null);
  if (cached) { event.waitUntil(network); return cached; }
  const res = await network;
  return res || (fallback && (await caches.match(fallback))) || Response.error();
}

async function networkFirst(event, cacheName) {
  const { request } = event;
  try {
    const res = await fetch(request);
    event.waitUntil(put(cacheName, request, res.clone()));
    return res;
  } catch (e) {
    return (await caches.match(request)) || Response.error();
  }
}

async function cacheFirst(event, cacheName) {
  const cached = await caches.match(event.request);
  if (cached) return cached;
  const res = await fetch(event.request);
  event.waitUntil(put(cacheName, event.request, res.clone()));
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (NEVER.test(url.pathname)) return;

  if (url.origin !== self.location.origin) {
    if (LIB_HOSTS.includes(url.hostname)) event.respondWith(cacheFirst(event, CACHES.libs));
    return;   // any other origin: not intercepted, never cached
  }
  if (!url.href.startsWith(BASE)) return;   // outside the app's scope
  const path = url.href.slice(BASE.length).split("?")[0];

  if (path === "data/news.json") return event.respondWith(networkFirst(event, CACHES.data));
  if (path.startsWith("data/") && /\.(json|geojson)$/.test(path)) return event.respondWith(staleWhileRevalidate(event, CACHES.data));
  if (path.startsWith("photos/") || (path.startsWith("fonts/") && !SHELL.includes(path))) return event.respondWith(cacheFirst(event, CACHES.media));
  // Pages and the rest of the shell. An uncached page offline falls back to the home page.
  if (request.mode === "navigate") return event.respondWith(staleWhileRevalidate(event, CACHES.shell, new URL("index.html", BASE).href));
  event.respondWith(staleWhileRevalidate(event, CACHES.shell));
});
