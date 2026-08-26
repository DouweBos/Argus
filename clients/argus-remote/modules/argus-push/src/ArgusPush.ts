import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

interface ArgusPushModule {
  setPushKey: (base64Key: string) => void;
  clearPushKey: () => void;
}

// Optional: Android decrypts in a JS background task, so it has no module, and
// Expo Go has no native code at all.
const native = requireOptionalNativeModule<ArgusPushModule>("ArgusPush");

/**
 * Share the push key with the iOS notification service extension, which runs
 * in its own process and can't reach the app's own storage.
 */
export function setSharedPushKey(base64Key: string): void {
  if (Platform.OS === "ios") {
    native?.setPushKey(base64Key);
  }
}

export function clearSharedPushKey(): void {
  if (Platform.OS === "ios") {
    native?.clearPushKey();
  }
}
