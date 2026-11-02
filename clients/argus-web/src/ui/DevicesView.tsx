/**
 * Lists the simulators/emulators currently booted on the desktop. Selecting a
 * device opens its live screen (DeviceScreen). Polls `devices.list` on an
 * interval, since there is no server-push channel for the device set.
 */

import { useCallback } from "react";
import { AgentRow, EmptyState, Icons, SidebarSection } from "@argus/peacock";
import type { RemoteDevice, RemotePlatform } from "../lib/protocol";
import { useConnectionStore } from "../stores/connection";
import { useDevicesStore } from "../stores/devices";
import { DeviceHostsSection } from "./DeviceHostsSection";
import { useLiveRefresh } from "./useLiveRefresh";

export function DevicesView({
  onOpen,
}: {
  onOpen: (device: RemoteDevice) => void;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const devices = useDevicesStore((s) => s.devices);
  const refreshDevices = useDevicesStore((s) => s.refreshDevices);

  const refresh = useCallback(() => {
    refreshDevices({ background: true }).catch(() => {});
  }, [refreshDevices]);
  useLiveRefresh(connection === "ready", refresh);

  if (devices.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Icons.SimulatorIcon size={22} />}
          title="No devices running"
          body="Boot a simulator or emulator in Argus on your computer and it'll show up here."
        />
        <div className="aw-sidebar">
          <DeviceHostsSection />
        </div>
      </>
    );
  }

  return (
    <div className="aw-sidebar">
      <SidebarSection count={devices.length}>Devices</SidebarSection>
      {devices.map((d) => (
        <AgentRow
          key={`${d.platform}:${d.id}`}
          name={d.name}
          status={d.capturing ? "running" : "idle"}
          meta={d.capturing ? "live" : platformLabel(d.platform)}
          model={d.capturing ? platformLabel(d.platform) : undefined}
          role="button"
          tabIndex={0}
          style={{ cursor: "pointer" }}
          onClick={() => onOpen(d)}
        />
      ))}
      <DeviceHostsSection />
    </div>
  );
}

function platformLabel(platform: RemotePlatform): string {
  return platform === "ios" ? "iOS simulator" : "Android emulator";
}
