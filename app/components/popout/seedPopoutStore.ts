import type { Platform } from "../../stores/simulatorStore";
import {
  selectAndroidDevice,
  selectDevice,
  selectVideoInput,
  setAndroidCapturing,
  setAndroidDevices,
  setAndroidToolsStatus,
  setCapturing,
  setDevices,
  setIosToolsStatus,
  setPlatform,
} from "../../stores/simulatorStore";

export const POPOUT_SESSION_ID = "__popout__";

export interface PopoutTarget {
  /** Already streaming — the main process acquired a capture ref before opening. */
  capturing: boolean;
  deviceKey: string;
  deviceName: string;
  /** Booted (iOS/Android) or connected (video input). */
  online: boolean;
  platform: Platform;
  runtime: string;
}

/**
 * Seed the popout's runtime store before first render. The popout runs in its
 * own BrowserWindow with a fresh Zustand store, so we prime it with the target
 * passed in via URL params — otherwise it opens on whatever platform the main
 * window last persisted, with no device selected.
 */
export function seedPopoutStore(target: PopoutTarget): void {
  const { platform, deviceKey, deviceName, runtime, online, capturing } =
    target;

  setPlatform(platform);

  if (platform === "ios") {
    setIosToolsStatus(true, null);
    setDevices([
      { udid: deviceKey, name: deviceName, runtime, booted: online },
    ]);
    selectDevice(POPOUT_SESSION_ID, deviceKey);
    setCapturing(capturing);

    return;
  }

  if (platform === "android") {
    setAndroidToolsStatus(true, null);
    // Stub entry only — RuntimeTargetPicker refetches the real device list on
    // mount; this just avoids a flash of the "no devices" placeholder.
    setAndroidDevices([
      {
        serial: deviceKey,
        name: deviceName,
        online,
        avdName: null,
        isTv: false,
        type: "emulator",
      },
    ]);
    selectAndroidDevice(POPOUT_SESSION_ID, deviceKey);
    setAndroidCapturing(capturing);

    return;
  }

  if (platform === "video") {
    // Video inputs are enumerated in the renderer; `deviceId` is stable across
    // windows of the same Electron session, so selecting it here is enough.
    selectVideoInput(POPOUT_SESSION_ID, deviceKey);
  }
}
