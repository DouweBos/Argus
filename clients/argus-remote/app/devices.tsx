/**
 * Simulators/emulators booted on the desktop. Selecting one opens its live
 * screen. Polls `devices.list` — there's no server-push channel for the set.
 */

import { useCallback } from "react";
import { useRouter } from "expo-router";
import * as Icons from "../src/components/Icons";
import { AgentRow } from "../src/components/rows";
import { EmptyState, Screen, SectionHeader } from "../src/components/ui";
import { useLiveRefresh } from "../src/hooks/useLiveRefresh";
import type { RemotePlatform } from "../src/lib/protocol";
import { useAppStore } from "../src/stores/appStore";
import { useTheme } from "../src/theme";

function platformLabel(platform: RemotePlatform): string {
  return platform === "ios" ? "iOS simulator" : "Android emulator";
}

export default function DevicesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const connection = useAppStore((s) => s.connection);
  const devices = useAppStore((s) => s.devices);
  const refreshDevices = useAppStore((s) => s.refreshDevices);

  const refresh = useCallback(() => {
    refreshDevices().catch(() => {});
  }, [refreshDevices]);
  useLiveRefresh(connection === "ready", refresh);

  if (devices.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon={<Icons.Simulator size={22} color={theme.textMuted} />}
          title="No devices running"
          body="Boot a simulator or emulator in Argus on your computer and it'll show up here."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader count={devices.length}>Devices</SectionHeader>
      {devices.map((d) => (
        <AgentRow
          key={`${d.platform}:${d.id}`}
          name={d.name}
          status={d.capturing ? "running" : "idle"}
          meta={d.capturing ? "live" : platformLabel(d.platform)}
          model={d.capturing ? platformLabel(d.platform) : undefined}
          onPress={() =>
            router.push({
              pathname: "/device/[id]",
              params: {
                id: d.id,
                platform: d.platform,
                name: d.name,
                tv: d.is_tv ? "1" : "0",
              },
            })
          }
        />
      ))}
    </Screen>
  );
}
