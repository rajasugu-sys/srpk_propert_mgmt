/* SRKP Rental Tool — W3C Web Push Service Worker */

if (typeof workbox === 'undefined') {
  self.addEventListener('install', () => {
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
  });
}

self.addEventListener('push', (event) => {
  let payload = {
    title: 'SRKP Rental Tool Reminder',
    body: 'You have an updated property management reminder.',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: 'srpk-reminder',
    data: { url: '/?view=invoices' },
  };

  if (event.data) {
    try {
      const parsed = event.data.json();
      payload = {
        ...payload,
        ...parsed,
        data: {
          ...payload.data,
          ...(parsed.data || {}),
        },
      };
    } catch {
      const text = event.data.text();
      if (text) {
        payload.body = text;
      }
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || '/pwa-192x192.png',
      badge: payload.badge || '/pwa-192x192.png',
      tag: payload.tag || 'srpk-reminder',
      renotify: true,
      data: payload.data,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification &&
      event.notification.data &&
      event.notification.data.url) ||
    '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            if (typeof client.postMessage === 'function') {
              client.postMessage({
                type: 'SRKP_PUSH_NAVIGATE',
                url: targetUrl,
              });
            }
            if ('navigate' in client && typeof client.navigate === 'function') {
              return client.navigate(targetUrl).then((navClient) => {
                return (navClient || client).focus();
              });
            }
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
