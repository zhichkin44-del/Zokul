/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_PREFIX = 'zokul-rt-';
const CACHE_VERSION = 'v1';
const RUNTIME_CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;

// Precache only hashed static assets from the build manifest.
import { precacheAndRoute } from 'workbox-precaching';
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('install', () => {
  self.skipWaiting();
});

// Claim clients and remove stale runtime caches from previous versions so a
// new deploy does not require a manual Safari data wipe.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((n) => n.startsWith(CACHE_PREFIX) && n !== RUNTIME_CACHE)
            .map((n) => caches.delete(n))
        )
      )
      .then(() => self.clientsClaim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const isNavigation = request.mode === 'navigate';
  const isApi = url.pathname.startsWith('/api/');
  const isSocket = url.pathname.startsWith('/socket.io/');
  const isUpload = url.pathname.startsWith('/uploads/');

  // Network-only for navigation, API, socket.io, and uploads. Never cache these.
  if (isNavigation || isApi || isSocket || isUpload) {
    event.respondWith(fetch(request));
    return;
  }

  // For everything else (hashed static assets), do not intercept — let Workbox
  // precache serve manifest entries itself. No aggressive offline cache.
});
