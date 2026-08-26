/**
 * Push credential helpers. Split from `dispatch` so the gateway's capability
 * handlers can ask "is push usable?" without importing the dispatcher (which
 * imports the gateway back).
 */

import { getPushConfig, savePushConfig, type PushConfig } from "../deviceStore";
import { DEFAULT_RELAY_URL } from "./relay";
import { generateVapidKeys, isWebPushConfigured } from "./webpush";

/** What the renderer sees — never the keys themselves. */
export interface PushConfigStatus {
  enabled: boolean;
  webPushConfigured: boolean;
  /** VAPID contact claim sent to the browser's push service. */
  vapidSubject: string;
  /** Where phones register their relay auth key. */
  relayUrl: string;
}

/**
 * Whether a push would actually reach anything. Browsers always can (VAPID
 * needs no credentials) and phones can via the relay, so in practice this only
 * says no when the whole feature is switched off.
 */
export async function isPushConfigured(): Promise<boolean> {
  const config = await getPushConfig();

  return config.enabled;
}

/**
 * The VAPID public key browsers subscribe with, minting the keypair on first
 * ask. Argus is its own application server for Web Push, so generating it
 * lazily keeps browsers zero-config.
 */
export async function ensureVapidPublicKey(): Promise<string> {
  const config = await getPushConfig();
  if (isWebPushConfigured(config)) {
    return config.vapid_public;
  }
  const keys = generateVapidKeys();
  await savePushConfig({
    vapid_private_pem: keys.privatePem,
    vapid_public: keys.publicKey,
  });

  return keys.publicKey;
}

/** Where native clients register their relay auth key. */
export function relayUrlFor(config: PushConfig): string {
  return config.relay_url || DEFAULT_RELAY_URL;
}

export async function getPushConfigStatus(): Promise<PushConfigStatus> {
  const config = await getPushConfig();

  return {
    enabled: config.enabled,
    webPushConfigured: isWebPushConfigured(config),
    vapidSubject: config.vapid_subject,
    relayUrl: relayUrlFor(config),
  };
}

/** Persist a config patch. */
export async function setPushConfig(
  patch: Partial<PushConfig>,
): Promise<PushConfigStatus> {
  await savePushConfig(patch);

  return getPushConfigStatus();
}
