import type { DebugToolDef } from "./types";
import type { DeviceInfo } from "../../../../lib/types";
import type { RuntimePickerSection } from "@argus/peacock";
import { useMemo, useState } from "react";
import { Icons, RuntimePicker, SegmentedControl } from "@argus/peacock";
import { useDevicePoller, useDevices } from "../../../../stores/deviceStore";
import styles from "./DebugTool.module.css";
import { OneshotView } from "./OneshotView";
import { StreamView } from "./StreamView";
import { DEBUG_TOOLS } from "./registry";

interface DebugToolProps {
  sessionId: string | null;
}

const PLATFORM_HEADERS: Record<string, string> = {
  ios: "iOS Simulators",
  android: "Android Emulators",
  web: "Web",
};

const PLATFORM_ORDER = ["ios", "android", "web"] as const;

/**
 * Debug panel shell. Picks a device, picks a tool, and renders the
 * matching view (stream or oneshot). No business logic lives here —
 * each tool's behavior is driven by its entry in `registry.ts`.
 */
export function DebugTool({ sessionId: _sessionId }: DebugToolProps) {
  useDevicePoller(5000);
  const devices = useDevices();

  const [selectedDeviceKey, setSelectedDeviceKey] = useState<string | null>(
    null,
  );
  const [activeToolId, setActiveToolId] = useState<string>(DEBUG_TOOLS[0].id);
  const activeTool =
    DEBUG_TOOLS.find((t) => t.id === activeToolId) ?? DEBUG_TOOLS[0];

  const sections = useMemo<RuntimePickerSection[]>(
    () =>
      PLATFORM_ORDER.map((platform) => ({
        header: PLATFORM_HEADERS[platform],
        items: devices
          .filter((d) => d.platform === platform)
          .map((d) => ({
            id: d.deviceKey,
            label: d.name,
            trailing: d.online ? "booted" : undefined,
            selected: d.deviceKey === selectedDeviceKey,
            onSelect: () => setSelectedDeviceKey(d.deviceKey),
          })),
      })),
    [devices, selectedDeviceKey],
  );

  const selected = devices.find((d) => d.deviceKey === selectedDeviceKey);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.deviceRow}>
          <RuntimePicker
            icon={<Icons.SimulatorIcon size={10} />}
            label={selected?.name ?? "Pick device"}
            muted={!selected}
            sections={sections}
          />
          <SegmentedControl
            aria-label="Debug tool"
            options={DEBUG_TOOLS.map((t) => ({ label: t.label, value: t.id }))}
            value={activeToolId}
            onChange={setActiveToolId}
          />
        </div>
      </div>

      <div className={styles.body}>{renderBody(selected, activeTool)}</div>
    </div>
  );
}

function renderBody(
  device: DeviceInfo | undefined,
  tool: DebugToolDef,
): React.ReactNode {
  if (!device) {
    return (
      <div className={styles.empty}>
        <p>Pick a device to begin.</p>
      </div>
    );
  }
  const key = `${tool.id}:${device.deviceKey}`;
  if (tool.kind === "stream") {
    return <StreamView key={key} deviceKey={device.deviceKey} tool={tool} />;
  }

  return <OneshotView key={key} deviceKey={device.deviceKey} tool={tool} />;
}
