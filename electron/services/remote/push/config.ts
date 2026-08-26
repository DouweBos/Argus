/**
 * Push credential helpers. Split from `dispatch` so the gateway's capability
 * handlers can ask "is push usable?" without importing the dispatcher (which
 * imports the gateway back).
 */

import { getPushConfig, savePushConfig, type PushConfig } from "../deviceStore";
import { closeApnsSessions, isApnsConfigured, resetApnsToken } from "./apns";
import { isFcmConfigured, resetFcmToken } from "./fcm";
import { DEFAULT_RELAY_URL } from "./relay";
import { generateVapidKeys, isWebPushConfigured } from "./webpush";

/** What the renderer sees — presence flags, never the secrets themselves. */
export interface PushConfigStatus {
  enabled: boolean;
  apnsConfigured: boolean;
  apnsKeyId: string;
  apnsTeamId: string;
  apnsBundleId: string;
  fcmConfigured: boolean;
  /** Firebase project the service account belongs to, for display. */
  fcmProjectId: string | null;
  webPushConfigured: boolean;
  /** VAPID contact claim sent to the browser's push service. */
  vapidSubject: string;
  /** Where phones register, or null when this desktop pushes Apple/Google direct. */
  relayUrl: string | null;
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
 * Where native clients register their relay auth key. Null means this desktop
 * has its own Apple/Firebase credentials and talks to them directly — a
 * self-hosted build, which is expected to configure every platform it ships.
 */
export function relayUrlFor(config: PushConfig): string | null {
  if (isApnsConfigured(config) || isFcmConfigured(config)) {
    return null;
  }

  return config.relay_url || DEFAULT_RELAY_URL;
}

/**
 * The VAPID public key browsers subscribe with, minting the keypair on first
 * ask. Unlike APNs/FCM this needs nothing from the user — Argus is its own
 * application server — so generating it lazily keeps web push zero-config.
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

function projectId(config: PushConfig): string | null {
  try {
    return (
      (JSON.parse(config.fcm_service_account) as { project_id?: string })
        .project_id ?? null
    );
  } catch {
    return null;
  }
}

export async function getPushConfigStatus(): Promise<PushConfigStatus> {
  const config = await getPushConfig();

  return {
    enabled: config.enabled,
    apnsConfigured: isApnsConfigured(config),
    apnsKeyId: config.apns_key_id,
    apnsTeamId: config.apns_team_id,
    apnsBundleId: config.apns_bundle_id,
    fcmConfigured: isFcmConfigured(config),
    fcmProjectId: projectId(config),
    webPushConfigured: isWebPushConfigured(config),
    vapidSubject: config.vapid_subject,
    relayUrl: relayUrlFor(config),
  };
}

/** Persist a credential patch and drop any cached provider tokens. */
export async function setPushConfig(
  patch: Partial<PushConfig>,
): Promise<PushConfigStatus> {
  await savePushConfig(patch);
  resetApnsToken();
  resetFcmToken();
  closeApnsSessions();

  return getPushConfigStatus();
}
