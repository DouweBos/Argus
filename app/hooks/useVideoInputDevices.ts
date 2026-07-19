import { useEffect, useState } from "react";

/**
 * Enumerates connected video inputs (capture cards / cameras) and keeps the
 * list fresh on hot-plug via the `devicechange` event. Labels are empty until
 * camera permission is granted (i.e. after the first live view).
 */
export function useVideoInputDevices(): MediaDeviceInfo[] {
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) {
      return;
    }
    const refresh = () => {
      md.enumerateDevices()
        .then((ds) => setVideoInputs(ds.filter((d) => d.kind === "videoinput")))
        .catch(() => {
          // Ignore — enumeration can fail transiently.
        });
    };
    refresh();
    md.addEventListener("devicechange", refresh);

    return () => md.removeEventListener("devicechange", refresh);
  }, []);

  return videoInputs;
}

/** Fallback label for a video input that has no label yet (no permission). */
export function videoInputLabel(
  device: MediaDeviceInfo,
  index: number,
): string {
  return device.label || `Video input ${String(index + 1)}`;
}
