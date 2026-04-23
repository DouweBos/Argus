import type { ContextMenuItem } from "@argus/peacock";
import { useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, Icons } from "@argus/peacock";
import { listAndroidDevices, listSimulators } from "../../../lib/ipc";
import {
  selectAndroidDevice,
  selectDevice,
  setAndroidDevices,
  setDevices,
  setPlatform,
  useRuntimeTargetState,
} from "../../../stores/simulatorStore";
import styles from "./RuntimeTargetPicker.module.css";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const sid = sessionId ?? SESSION_GLOBAL;

  // Fetch both platform device lists on mount and when the picker opens so
  // the menu reflects current reality no matter what platform is active.
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
  }, [menuOpen]);

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

  const openMenu = () => {
    const el = triggerRef.current;
    if (!el) {
      return;
    }
    const rect = el.getBoundingClientRect();
    setMenuPos({ x: rect.left, y: rect.bottom + 4 });
    setMenuOpen(true);
  };

  const items = useMemo<ContextMenuItem[]>(() => {
    const list: ContextMenuItem[] = [];
    if (devices.length > 0) {
      list.push({ header: "iOS Simulators" });
      for (const d of devices) {
        const selected = platform === "ios" && d.udid === iosUdid;
        list.push({
          label: d.name,
          trailing: d.booted ? "booted" : undefined,
          selected,
          onClick: () => {
            setPlatform("ios");
            selectDevice(sid, d.udid);
          },
        });
      }
    }
    if (androidDevices.length > 0) {
      if (list.length > 0) {
        list.push({ separator: true });
      }
      list.push({ header: "Android Emulators" });
      for (const d of androidDevices) {
        const selected = platform === "android" && d.serial === androidSerial;
        list.push({
          label: d.name ?? d.serial,
          selected,
          onClick: () => {
            setPlatform("android");
            selectAndroidDevice(sid, d.serial);
          },
        });
      }
    }
    if (list.length > 0) {
      list.push({ separator: true });
    }
    list.push({ header: "Web" });
    list.push({
      label: "Chromium",
      selected: platform === "web",
      onClick: () => {
        setPlatform("web");
      },
    });

    return list;
  }, [devices, androidDevices, platform, iosUdid, androidSerial, sid]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={openMenu}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
      >
        <span className={styles.triggerIcon}>{icon}</span>
        <span
          className={`${styles.triggerLabel} ${muted ? styles.triggerLabelMuted : ""}`}
        >
          {label}
        </span>
        <Icons.ChevronDownIcon className={styles.triggerChevron} size={10} />
      </button>
      {menuOpen && (
        <ContextMenu
          items={items}
          position={menuPos}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </>
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
