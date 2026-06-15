// Mnemosyne service worker.
//
// Phase 2 ships the PWA shell + browser notifications fired from an open tab
// (see lib/notify + ProactiveNotifier). This worker exists so the app is
// installable and so background Push can be added later without a retrofit:
// the `push` handler below is already wired — it just needs a subscription +
// VAPID keys on the server to start receiving events.

self.addEventListener("install", () => {
  // Activate this worker immediately rather than waiting for old tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Future: server-sent Web Push. No-op until a push subscription exists.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Mnemosyne", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Mnemosyne";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag,
      data: { url: data.url || "/" },
      icon: "/icon.svg",
      badge: "/icon.svg",
    }),
  );
});

// Focus an existing tab (or open one) when a notification is clicked.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
