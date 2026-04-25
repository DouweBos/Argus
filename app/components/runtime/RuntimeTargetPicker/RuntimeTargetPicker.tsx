import type { RuntimePickerSection } from "@argus/peacock";
import { useEffect, useMemo } from "react";
import { Icons, RuntimePicker } from "@argus/peacock";
import { listAndroidDevices, listSimulators } from "../../../lib/ipc";
import {
  selectAndroidDevice,
  selectDevice,
  setAndroidDevices,
  setDevices,
  setPlatform,
  useRuntimeTargetState,
} from "../../../stores/simulatorStore";

interface RuntimeTargetPickerProps {
  sessionId: string | null;
}

const SESSION_GLOBAL = "__global__";

/**
 * Single control replacing the old "platform chips + device dropdown" combo.
 * Platform and device are naturally coupled — picking a device implies the
 * platform, so selecting a target updates both the active platform and the
 * session's device pick in one action.
 *
 * Lists *all* devices regardless of the active platform. The native simulator
 * views only populate their device lists while they're mounted, which would
 * blank the menu after a user switches to Web and back. We re-fetch here on
 * mount to keep every option available at all times.
 */
export function RuntimeTargetPicker({ sessionId }: RuntimeTargetPickerProps) {
  const { platform, devices, androidDevices, iosUdid, androidSerial } =
    useRuntimeTargetState(sessionId);

  const sid = sessionId ?? SESSION_GLOBAL;

  useEffect(() => {
    listSimulators()
      .then(setDevices)
      .catch(() => {
        // Tools missing — handled elsewhere; just leave the list empty.
      });
    listAndroidDevices()
      .then(setAndroidDevices)
      .catch(() => {
        // Same — ADB/emulator not available.
      });
  }, []);

  const sections = useMemo<RuntimePickerSection[]>(
    () => [
      {
        header: "iOS Simulators",
        items: devices.map((d) => ({
          id: d.udid,
          label: d.name,
          trailing: d.booted ? "booted" : undefined,
          selected: platform === "ios" && d.udid === iosUdid,
          onSelect: () => {
            setPlatform("ios");
            selectDevice(sid, d.udid);
          },
        })),
      },
      {
        header: "Android Emulators",
        items: androidDevices.map((d) => ({
          id: d.serial,
          label: d.name ?? d.serial,
          selected: platform === "android" && d.serial === androidSerial,
          onSelect: () => {
            setPlatform("android");
            selectAndroidDevice(sid, d.serial);
          },
        })),
      },
      {
        header: "Web",
        items: [
          {
            id: "chromium",
            label: "Chromium",
            selected: platform === "web",
            onSelect: () => {
              setPlatform("web");
            },
          },
        ],
      },
    ],
    [devices, androidDevices, platform, iosUdid, androidSerial, sid],
  );

  const { icon, label, muted } = useMemo(
    () =>
      renderTriggerContent({
        platform,
        devices,
        androidDevices,
        iosUdid,
        androidSerial,
      }),
    [platform, devices, androidDevices, iosUdid, androidSerial],
  );

  return (
    <RuntimePicker
      icon={icon}
      label={label}
      muted={muted}
      sections={sections}
    />
  );
}

function renderTriggerContent({
  platform,
  devices,
  androidDevices,
  iosUdid,
  androidSerial,
}: {
  androidDevices: { name?: string; serial: string }[];
  androidSerial: string | null;
  devices: { name: string; udid: string }[];
  iosUdid: string | null;
  platform: "android" | "ios" | "web";
}): { icon: React.ReactNode; label: string; muted: boolean } {
  if (platform === "web") {
    return {
      icon: <Icons.WebIcon size={10} />,
      label: "Chromium",
      muted: false,
    };
  }
  if (platform === "ios") {
    const device = devices.find((d) => d.udid === iosUdid);

    return {
      icon: <Icons.SimulatorIcon size={10} />,
      label: device?.name ?? "Pick device",
      muted: !device,
    };
  }
  const device = androidDevices.find((d) => d.serial === androidSerial);

  return {
    icon: <Icons.SimulatorIcon size={10} />,
    label: device?.name ?? device?.serial ?? "Pick device",
    muted: !device,
  };
}
