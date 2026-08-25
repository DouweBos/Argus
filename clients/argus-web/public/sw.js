/**
 * Service worker for Web Push. The desktop encrypts each notification for this
 * browser's subscription (RFC 8291) and posts it straight to the push service,
 * so this runs even with every Argus tab closed.
 */

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Argus", body: event.data ? event.data.text() : "" };
  }

  const data = payload.data ?? {};
  // The desktop decides the buttons so every surface offers the same ones.
  const actions = (payload.actions ?? []).map((a) => ({
    action: a.id,
    title: a.title,
  }));
  event.waitUntil(
    self.registration.showNotification(payload.title || "Argus", {
      body: payload.body || "",
      tag: payload.tag,
      renotify: Boolean(payload.tag),
      requireInteraction: data.kind === "permission",
      actions,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const action = event.action;
  const deciding =
    (action === "approve" || action === "deny") && data.agentId && data.toolUseId;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const open = windows.find((c) =>
        c.url.startsWith(self.registration.scope),
      );

      // An open tab holds the gateway connection, so hand it the intent. Only
      // focus for a plain click — answering a prompt shouldn't steal the screen.
      if (open) {
        if (!deciding) {
          await open.focus();
        }
        open.postMessage({
          type: deciding ? "argus-decide-prompt" : "argus-open-agent",
          decision: action === "approve" ? "allow" : "deny",
          ...data,
        });

        return;
      }

      // Nothing is running: encode the intent in the URL so the page replays it
      // as soon as it reconnects.
      const params = new URLSearchParams();
      if (data.agentId) {
        params.set("agent", data.agentId);
      }
      if (deciding) {
        params.set("decide", action === "approve" ? "allow" : "deny");
        params.set("tool", data.toolUseId);
      }
      const query = params.toString();
      await self.clients.openWindow(
        query ? `${self.registration.scope}?${query}` : self.registration.scope,
      );
    })(),
  );
});

// Take over existing tabs immediately so a fresh worker starts handling pushes.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
