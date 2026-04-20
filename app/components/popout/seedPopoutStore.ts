import {
  selectDevice,
  setCapturing,
  setDevices,
  setIosToolsStatus,
  setMjpegPort,
} from "../../stores/simulatorStore";

export const POPOUT_SESSION_ID = "__popout__";

/**
 * Seed the popout's simulator store before first render. The popout runs in
 * its own BrowserWindow with a fresh Zustand store, so we prime it with the
 * device + live capture port passed in via URL params. This avoids flashing
 * the "Boot a simulator" placeholder and skips the auto-start effect that
 * would otherwise conflict with the main window's capture session.
 */
export function seedPopoutStore(args: {
  booted: boolean;
  deviceName: string;
  mjpegPort: number | null;
  runtime: string;
  udid: string;
}) {
  const { udid, deviceName, runtime, booted, mjpegPort } = args;
  setIosToolsStatus(true, null);
  setDevices([{ udid, name: deviceName, runtime, booted }]);
  selectDevice(POPOUT_SESSION_ID, udid);
  if (mjpegPort != null) {
    setMjpegPort(udid, mjpegPort);
    setCapturing(true);
  }
}
