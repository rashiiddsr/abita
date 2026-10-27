/* Web Push ABiTA: dimuat oleh service worker aplikasi (sw.js, lewat importScripts di vite.config.ts). */
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: "ABiTA", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "ABiTA", {
      body: d.body || "",
      icon: "/staff/icons/Icon-192.png",
      badge: "/staff/icons/Icon-192.png",
      tag: d.tag,
      renotify: !!d.tag,
      lang: "id",
      data: { url: d.url || "/staff/notifications" },
    }),
  );
});

// ketuk notifikasi: buka aplikasi yang sudah terbuka (pindah ke halamannya) atau buka jendela baru
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/staff/notifications", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = wins.find((c) => new URL(c.url).pathname.startsWith("/staff"));
      if (app) {
        await app.focus();
        if ("navigate" in app) await app.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
