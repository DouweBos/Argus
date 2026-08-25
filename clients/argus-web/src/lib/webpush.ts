/**
 * Web Push registration. The desktop is the application server — it holds the
 * VAPID key and signs its own requests — so the browser only ever hands its
 * subscription back over the (already encrypted) gateway channel.
 *
 * Requires a secure context: over a tunnel (https) this works; over plain
 * `http://<lan-ip>` browsers refuse to register a service worker at all.
 */

import type { Transport } from "./transport";
import { routeAgentOpen } from "./notify";

type Decide = (
  agentId: string,
  toolUseId: string,
  decision: "allow" | "deny",
) => void;

let decide: Decide | null = null;

/** Register how an Approve/Deny button answers its prompt. */
export function setNotificationDecider(fn: Decide | null): void {
  decide = fn;
}

const PREF_KEY = "argus.push.enabled";

export type WebPushState =
  | "off"
  | "registered"
  | "unavailable"
  | "unconfigured";

export function webPushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof PushManager !== "undefined" &&
    window.isSecureContext
  );
}

/** Whether the user wants background push here (defaults to on). */
export function pushPreference(): boolean {
  return localStorage.getItem(PREF_KEY) !== "off";
}

export function setPushPreference(enabled: boolean): void {
  localStorage.setItem(PREF_KEY, enabled ? "on" : "off");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }

  return out;
}

function bytesToBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) {
    return "";
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

let registration: ServiceWorkerRegistration | null = null;

/**
 * Register the worker. Done even with background push off, because it is also
 * what renders a notification's quick-action buttons while a tab is open.
 */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) {
    return registration;
  }
  try {
    registration = await navigator.serviceWorker.register("sw.js");

    return registration;
  } catch {
    return null;
  }
}

/** Route notification clicks the service worker forwards to this tab. */
export function startServiceWorkerRouting(): () => void {
  if (!("serviceWorker" in navigator)) {
    return () => {};
  }
  void ensureServiceWorker();
  const onMessage = (event: MessageEvent) => {
    const data = event.data as {
      agentId?: string;
      decision?: "allow" | "deny";
      label?: string;
      toolUseId?: string;
      type?: string;
    };
    if (data?.type === "argus-open-agent" && data.agentId) {
      routeAgentOpen(data.agentId, data.label ?? "Agent");
    }
    if (
      data?.type === "argus-decide-prompt" &&
      data.agentId &&
      data.toolUseId &&
      data.decision
    ) {
      decide?.(data.agentId, data.toolUseId, data.decision);
    }
  };
  navigator.serviceWorker.addEventListener("message", onMessage);

  return () =>
    navigator.serviceWorker.removeEventListener("message", onMessage);
}

interface PushInfo {
  configured: boolean;
  enabled: boolean;
  vapid_public_key: string | null;
}

/**
 * Subscribe this browser and hand the subscription to the desktop. Safe to call
 * on every connect — an existing subscription is reused, and re-registering the
 * same endpoint is a no-op on the desktop side.
 */
export async function registerWebPush(
  transport: Transport,
): Promise<WebPushState> {
  if (!pushPreference() || !webPushSupported()) {
    return pushPreference() ? "unavailable" : "off";
  }
  if (Notification.permission !== "granted") {
    return "unavailable";
  }

  let info: PushInfo;
  try {
    info = await transport.request<PushInfo>("device.push_info", {});
  } catch {
    return "unavailable";
  }
  if (!info.enabled || !info.vapid_public_key) {
    return "unconfigured";
  }

  const reg = await ensureServiceWorker();
  if (!reg) {
    return "unavailable";
  }

  let subscription: PushSubscription | null;
  try {
    subscription = await reg.pushManager.getSubscription();
    const applicationServerKey = base64UrlToBytes(info.vapid_public_key);
    // A subscription minted for a different VAPID key can't be pushed to.
    if (
      subscription &&
      bytesToBase64Url(subscription.options.applicationServerKey) !==
        info.vapid_public_key
    ) {
      await subscription.unsubscribe();
      subscription = null;
    }
    subscription ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch {
    return "unavailable";
  }

  const p256dh = bytesToBase64Url(subscription.getKey("p256dh"));
  const auth = bytesToBase64Url(subscription.getKey("auth"));
  if (!p256dh || !auth) {
    return "unavailable";
  }

  try {
    const res = await transport.request<{ configured: boolean }>(
      "device.register_push",
      {
        service: "webpush",
        token: subscription.endpoint,
        keys: { p256dh, auth },
      },
    );

    return res.configured ? "registered" : "unconfigured";
  } catch {
    return "unavailable";
  }
}

/** Drop the subscription locally and tell the desktop to forget it. */
export async function unregisterWebPush(
  transport: Transport | null,
): Promise<void> {
  await transport?.request("device.unregister_push", {}).catch(() => {});
  const reg = await ensureServiceWorker();
  const subscription = await reg?.pushManager.getSubscription();
  await subscription?.unsubscribe().catch(() => {});
}
