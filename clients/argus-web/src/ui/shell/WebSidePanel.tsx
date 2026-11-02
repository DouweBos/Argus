/**
 * The side panel on the right, as on the Mac: a device, the session's
 * terminals, or its changes, beside whatever the centre shows.
 */

import { useState } from "react";
import { Icons, SidePanel, type SidePanelTab as Tab } from "@argus/peacock";
import type { RemotePlatform } from "../../lib/protocol";
import { capture } from "../../telemetry/telemetry";
import { ChangesView } from "../ChangesView";
import { DevicesView } from "../DevicesView";
import { DeviceRoute } from "../ScreenRoutes";
import { LazySessionTool } from "../SessionToolActions";
import { type SidePanelTab, useShellPrefs } from "./shellPrefs";

const DEVICE: Tab<SidePanelTab> = {
  id: "device",
  title: "Device",
  icon: <Icons.SimulatorIcon size={13} />,
};
const SESSION_TABS: Tab<SidePanelTab>[] = [
  { id: "terminal", title: "Terminal", icon: <Icons.TerminalIcon size={13} /> },
  { id: "changes", title: "Changes", icon: <Icons.GitChangesIcon size={13} /> },
];

function DeviceTab() {
  const [device, setDevice] = useState<{
    platform: RemotePlatform;
    deviceKey: string;
  } | null>(null);
  if (device) {
    return (
      <div className="aw-panel-body">
        <button
          className="aw-panel-back"
          type="button"
          onClick={() => setDevice(null)}
        >
          <Icons.ChevronLeftIcon size={11} /> All devices
        </button>
        <DeviceRoute deviceKey={device.deviceKey} platform={device.platform} />
      </div>
    );
  }

  return (
    <div className="aw-panel-body">
      <DevicesView
        onOpen={(d) => setDevice({ platform: d.platform, deviceKey: d.id })}
      />
    </div>
  );
}

export function WebSidePanel({ sessionId }: { sessionId: string | null }) {
  const tab = useShellPrefs((s) => s.panel.tab);
  const setPanelTab = useShellPrefs((s) => s.setPanelTab);
  const setPanelOpen = useShellPrefs((s) => s.setPanelOpen);
  const [mode, setMode] = useState<"branch" | "working">("working");
  const tabs = sessionId ? [DEVICE, ...SESSION_TABS] : [DEVICE];
  const shown = tabs.some((t) => t.id === tab) ? tab : "device";

  return (
    <SidePanel<SidePanelTab>
      selectedId={shown}
      tabs={tabs}
      onClose={() => {
        capture("web_side_panel_toggled", { open: false, tab: shown });
        setPanelOpen(false);
      }}
      onSelect={(next) => {
        capture("web_side_panel_toggled", { open: true, tab: next });
        setPanelTab(next);
      }}
    >
      {shown === "device" && <DeviceTab />}
      {shown === "terminal" && sessionId && (
        <div className="aw-panel-body aw-panel-fill">
          <LazySessionTool
            screen={{ name: "terminals", sessionId, terminalId: null }}
          />
        </div>
      )}
      {shown === "changes" && sessionId && (
        <div className="aw-panel-body">
          <ChangesView mode={mode} sessionId={sessionId} onModeChange={setMode} />
        </div>
      )}
    </SidePanel>
  );
}
