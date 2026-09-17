/**
 * The guest client for a `#/huddle/<token>` link.
 *
 * Single-agent by construction: the room names one agent and one device, and
 * this screen renders those two and nothing else — no projects, no sessions,
 * no agent switcher. The host refuses everything outside the room anyway; the
 * UI simply never offers it.
 */

import { useEffect, useState } from "react";
import { Icons, SidebarHeader, SidebarHeaderAction, Spinner } from "@argus/peacock";
import { huddlePanes, type HuddlePane, type HuddleView } from "../lib/huddleSession";
import { readGuestLabel, rememberGuestLabel } from "../lib/huddleIdentity";
import { useAppStore } from "../lib/store";
import { AgentTranscript } from "./AgentTranscript";
import { ChatInput } from "./ChatInput";
import { ConnectionBadge } from "./ConnectionBadge";
import { DeviceScreen } from "./DeviceScreen";
import { HuddleGate } from "./HuddleGate";

export function HuddleGuest({ token }: { token: string }) {
  const huddle = useAppStore((s) => s.huddle);
  const joinHuddle = useAppStore((s) => s.joinHuddle);
  // A reload of the same tab keeps the name and the key, so it rejoins without
  // asking the guest — or the host — anything a second time.
  const [label, setLabel] = useState(readGuestLabel);

  useEffect(() => {
    if (label && !huddle) {
      void joinHuddle(token, label);
    }
  }, [label, huddle, joinHuddle, token]);

  return (
    <HuddleGate
      state={huddle?.state ?? "connecting"}
      asked={!!label}
      defaultLabel={label}
      onJoin={(name) => {
        rememberGuestLabel(name);
        setLabel(name);
      }}
    >
      {huddle && <HuddleRoom view={huddle} />}
    </HuddleGate>
  );
}

/** The huddle proper: one agent's transcript and composer, one device. */
function HuddleRoom({ view }: { view: HuddleView }) {
  const agentId = view.agentId ?? "";
  const panes = huddlePanes(view);
  const [pane, setPane] = useState<HuddlePane>("agent");
  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.statusByAgent[agentId]);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const devices = useAppStore((s) => s.devices);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const hasDevice = panes.includes("device");

  useEffect(() => {
    if (connection === "ready" && agentId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [connection, agentId, loadAgentStatus]);

  useEffect(() => {
    if (connection === "ready" && hasDevice) {
      refreshDevices().catch(() => {});
    }
  }, [connection, hasDevice, refreshDevices]);

  // The list is already scoped to the room, so this is the device or nothing.
  const device = devices.find((d) => d.id === view.deviceKey) ?? null;
  const title = status?.title?.trim() || "Shared agent";

  return (
    <div className="aw-shell">
      <SidebarHeader
        className="aw-topbar"
        brand={
          <>
            <Icons.GuestsIcon size={16} />
            <span className="aw-topbar-title" title={title}>
              {title}
            </span>
          </>
        }
        actions={
          <>
            <ConnectionBadge state={connection} />
            {hasDevice && (
              <SidebarHeaderAction
                onClick={() => setPane(pane === "device" ? "agent" : "device")}
                title={pane === "device" ? "Conversation" : "Device"}
                aria-label={pane === "device" ? "Conversation" : "Device"}
              >
                {pane === "device" ? (
                  <Icons.AgentIcon size={14} />
                ) : (
                  <Icons.SimulatorIcon size={14} />
                )}
              </SidebarHeaderAction>
            )}
          </>
        }
      />

      <div className="aw-main">
        {pane === "agent" && <AgentTranscript agentId={agentId} />}
        {pane === "device" &&
          (device ? (
            <DeviceScreen
              deviceId={device.id}
              platform={device.platform}
              isTv={device.is_tv}
            />
          ) : (
            <div className="aw-center">
              <Spinner />
              <span className="aw-muted">Waiting for the device…</span>
            </div>
          ))}
      </div>

      {pane === "agent" && (
        <div className="aw-chat-dock">
          <ChatInput agentId={agentId} sessionId={status?.session_id} />
        </div>
      )}
    </div>
  );
}
