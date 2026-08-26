/**
 * Native push registration.
 *
 * Only the team that owns this bundle id can push to it, so notifications go
 * through the Argus relay, which holds the APNs/Firebase credentials. The relay
 * is not trusted with anything else: this device mints two keys — one that
 * seals the notification so the relay can't read it, one that proves to the
 * relay which desktops may push here — and hands both to its paired desktop
 * over the already-encrypted gateway.
 *
 * A desktop running its own Apple/Firebase credentials reports no relay, and
 * then the token alone is enough.
 */

import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { toBase64 } from "./base64";
import { readString, removeKey, writeString } from "./storage";
import { setSharedPushKey, clearSharedPushKey } from "../../modules/argus-push";

const TOKEN_KEY = "push.token";
const PREF_KEY = "push.enabled";
const RELAY_KEYS = "argus.push.keys";

export interface RelayKeys {
  /** Seals the notification. 32 bytes, base64. */
  pushKey: string;
  /** Authenticates senders to the relay. 32 bytes, base64. */
  authKey: string;
}

export interface PushRegistration extends Partial<RelayKeys> {
  service: "apns" | "fcm";
  token: string;
  environment?: "production" | "sandbox";
}

/** Whether the user has opted into background push (defaults to on). */
export async function pushPreference(): Promise<boolean> {
  return (await readString(PREF_KEY)) !== "off";
}

export async function setPushPreference(enabled: boolean): Promise<void> {
  await writeString(PREF_KEY, enabled ? "on" : "off");
}

function randomKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return toBase64(bytes);
}

/**
 * The device's long-lived relay keys, minted once. The sealing key is copied
 * into the shared App Group container on every load, because the notification
 * service extension runs in its own process and that's the only place it can
 * read from.
 */
export async function ensureRelayKeys(): Promise<RelayKeys> {
  const stored = await SecureStore.getItemAsync(RELAY_KEYS);
  if (stored) {
    const keys = JSON.parse(stored) as RelayKeys;
    setSharedPushKey(keys.pushKey);

    return keys;
  }
  const keys: RelayKeys = { pushKey: randomKey(), authKey: randomKey() };
  await SecureStore.setItemAsync(RELAY_KEYS, JSON.stringify(keys));
  setSharedPushKey(keys.pushKey);

  return keys;
}

async function clearRelayKeys(): Promise<void> {
  await SecureStore.deleteItemAsync(RELAY_KEYS).catch(() => {});
  clearSharedPushKey();
}

/**
 * Ask the OS for this install's push token. Returns null when the user hasn't
 * granted notification permission or the build has no push entitlement (e.g.
 * an iOS simulator).
 */
export async function getPushRegistration(): Promise<PushRegistration | null> {
  const perms = await Notifications.getPermissionsAsync();
  if (!perms.granted) {
    return null;
  }

  if (Platform.OS === "android") {
    // A channel must exist before Android will display anything we post.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Agent updates",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  let devicePushToken: Notifications.DevicePushToken;
  try {
    devicePushToken = await Notifications.getDevicePushTokenAsync();
  } catch {
    return null;
  }

  const token =
    typeof devicePushToken.data === "string"
      ? devicePushToken.data
      : String(devicePushToken.data);
  if (!token) {
    return null;
  }

  const keys = await ensureRelayKeys();
  if (devicePushToken.type === "ios") {
    return {
      service: "apns",
      token,
      // Debug builds get sandbox tokens; the relay corrects itself if this
      // guess is wrong, so it only ever costs one wasted round trip.
      environment: __DEV__ ? "sandbox" : "production",
      ...keys,
    };
  }

  return { service: "fcm", token, ...keys };
}

export type RelayRegistration = "conflict" | "failed" | "ok";

/**
 * Tell the relay which key may push here. Must happen before the desktop tries,
 * or the relay has nothing to verify its signature against.
 */
export async function registerWithRelay(
  relayUrl: string,
  registration: PushRegistration,
): Promise<RelayRegistration> {
  if (!registration.authKey) {
    return "failed";
  }
  try {
    const res = await fetch(`${relayUrl.replace(/\/$/, "")}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: registration.token,
        service: registration.service,
        auth_key: registration.authKey,
        ts: Date.now(),
      }),
    });
    if (res.ok) {
      return "ok";
    }

    // A previous install claimed this token and we no longer hold its key.
    // The relay expires registrations, so this resolves itself.
    return res.status === 409 ? "conflict" : "failed";
  } catch {
    return "failed";
  }
}

/** The last token we successfully registered, to skip redundant round trips. */
export async function lastRegisteredToken(): Promise<string | null> {
  return readString(TOKEN_KEY);
}

export async function rememberRegisteredToken(token: string): Promise<void> {
  await writeString(TOKEN_KEY, token);
}

export async function forgetRegisteredToken(): Promise<void> {
  await removeKey(TOKEN_KEY);
  await clearRelayKeys();
}
