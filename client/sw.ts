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
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const isNavigation = request.mode === 'navigate';
  const isApi = url.pathname.startsWith('/api/');
  const isSocket = url.pathname.startsWith('/socket.io/');
  const isUpload = url.pathname.startsWith('/uploads/');

  // Network-only for navigation, API, socket.io, and uploads. Never cache these:
  // API responses are private per user and must not outlive a logout.
  if (isNavigation || isApi || isSocket || isUpload) {
    event.respondWith(fetch(request));
    return;
  }

  // For everything else (hashed static assets), do not intercept — let Workbox
  // precache serve manifest entries itself. No aggressive offline cache.
});

// --- Push notifications -----------------------------------------------------

self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; data?: { chatId?: string } } = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = { body: event.data?.text() };
  }
  const chatId = data.data?.chatId;
  event.waitUntil(
    self.registration.showNotification(data.title || 'Zokul', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // One notification per chat: a new message replaces the previous one.
      tag: chatId ? `chat-${chatId}` : undefined,
      data: data.data,
    })
  );
});

// Focus an already open Zokul window and switch it to the chat instead of
// opening a second copy of the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId: string | undefined = event.notification.data?.chatId;
  const url = chatId ? `/?chat=${encodeURIComponent(chatId)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if (chatId) existing.postMessage({ type: 'open-chat', chatId });
        return;
      }
      await self.clients.openWindow(url);
    })
  );
});

// The browser rotated the subscription (expiry, key change): resubscribe and
// tell the server, otherwise notifications silently stop.
self.addEventListener('pushsubscriptionchange', (event) => {
  const change = event as Event & {
    oldSubscription?: PushSubscription | null;
    newSubscription?: PushSubscription | null;
    waitUntil(p: Promise<unknown>): void;
  };
  change.waitUntil(
    (async () => {
      let sub = change.newSubscription ?? null;
      if (!sub) {
        const res = await fetch('/api/push/vapid-key', { credentials: 'include' });
        const { publicKey } = await res.json();
        sub = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: publicKey,
        });
      }
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
    })()
  );
});
