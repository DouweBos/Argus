import { useEffect, useMemo, useState } from "react";

export interface VideoInputDevicesState {
  devices: MediaDeviceInfo[];
  /** False until the first enumeration resolves — callers must not treat the
   * empty list as "no video inputs" before then. */
  ready: boolean;
}

/**
 * Enumerates connected video inputs (capture cards / cameras) and keeps the
 * list fresh on hot-plug via the `devicechange` event. Labels are empty until
 * camera permission is granted (i.e. after the first live view).
 */
export function useVideoInputDevicesState(): VideoInputDevicesState {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // Nothing to wait for when the API is unavailable.
  const [ready, setReady] = useState(
    () => !navigator.mediaDevices?.enumerateDevices,
  );

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      return;
    }
    let cancelled = false;
    const refresh = () => {
      md.enumerateDevices()
        .then((ds) => {
          if (cancelled) {
            return;
          }
          setDevices(ds.filter((d) => d.kind === "videoinput"));
          setReady(true);
        })
        .catch(() => {
          // Ignore — enumeration can fail transiently.
        });
    };
    refresh();
    md.addEventListener("devicechange", refresh);

    return () => {
      cancelled = true;
      md.removeEventListener("devicechange", refresh);
    };
  }, []);

  return useMemo(() => ({ devices, ready }), [devices, ready]);
}

export function useVideoInputDevices(): MediaDeviceInfo[] {
  return useVideoInputDevicesState().devices;
}

/** Fallback label for a video input that has no label yet (no permission). */
export function videoInputLabel(
  device: MediaDeviceInfo,
  index: number,
): string {
  return device.label || `Video input ${String(index + 1)}`;
}
