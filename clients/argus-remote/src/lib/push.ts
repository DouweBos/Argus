/**
 * Native push registration. The desktop is the push provider — it signs its own
 * APNs/FCM requests — so all this client does is hand over the raw device token
 * it gets from the OS. Nothing is sent to Expo's push service.
 */

import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { readString, removeKey, writeString } from "./storage";

const TOKEN_KEY = "push.token";
const PREF_KEY = "push.enabled";

export interface PushRegistration {
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
    // A channel must exist before Android will display anything we push.
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

  if (devicePushToken.type === "ios") {
    return {
      service: "apns",
      token,
      // Dev builds get sandbox tokens; the desktop corrects itself if this
      // guess is wrong, so it only saves one wasted round trip.
      environment: __DEV__ ? "sandbox" : "production",
    };
  }

  return { service: "fcm", token };
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
}
