/**
 * The guest client for a `#/huddle/<token>` link.
 *
 * Single-agent by construction: the room names one agent and one device, and
 * this screen renders those two and nothing else — no projects, no sessions,
 * no agent switcher. The host refuses everything outside the room anyway; the
 * UI simply never offers it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  GuestList,
  HuddleChat,
  Icons,
  Input,
  ResizablePanel,
  SettingsScreenField,
  SidePanel,
  type SidePanelTab,
  SidebarHeader,
  SidebarHeaderAction,
  Spinner,
  TypingIndicator,
  useUnreadCount,
} from "@argus/peacock";
import {
  huddlePanes,
  typingNames,
  type HuddlePane,
  type HuddleView,
} from "../lib/huddleSession";

import { readGuestLabel, rememberGuestLabel } from "../lib/huddleIdentity";
import type { RemoteDevice } from "../lib/protocol";
import { useAgentsStore } from "../stores/agents";
import { useConnectionStore } from "../stores/connection";
import { useDevicesStore } from "../stores/devices";
import { useHuddleStore } from "../stores/huddle";
import { AgentTranscript } from "./transcript/AgentTranscript";
import { ChatInput } from "./ChatInput";
import { ConnectionBadge } from "./ConnectionBadge";
import { DeviceScreen } from "./DeviceScreen";
import { HuddleGate } from "./HuddleGate";
import { loadSidePanelWidth, saveSidePanelWidth } from "./sidebarWidth";
import { useIsWide } from "./useIsWide";

export function HuddleGuest({ token }: { token: string }) {
  const huddle = useHuddleStore((s) => s.huddle);
  const joinHuddle = useHuddleStore((s) => s.joinHuddle);
  // A reload of the same tab keeps the name and the key, so it rejoins without
  // asking the guest — or the host — anything a second time.
  const [label, setLabel] = useState(readGuestLabel);
  // Keyed on the token, not on `huddle`: a fresh link after a denied or ended
  // room is a new room, and must re-join rather than keep showing the old one.
  const joinedToken = useRef<string | null>(null);

  useEffect(() => {
    if (label && joinedToken.current !== token) {
      joinedToken.current = token;
      void joinHuddle(token, label);
    }
  }, [label, joinHuddle, token]);

  return (
    <HuddleGate
      state={huddle?.state ?? "connecting"}
      asked={!!label}
      defaultLabel={label}
      onJoin={(name) => {
        rememberGuestLabel(name);
        // Clear the guard so asking again after leaving actually re-joins,
        // even when the name (and therefore the effect's deps) didn't change.
        joinedToken.current = null;
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
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const leaveHuddle = useHuddleStore((s) => s.leaveHuddle);
  const connection = useConnectionStore((s) => s.connection);
  const status = useAgentsStore((s) => s.statusByAgent[agentId]);
  const loadAgentStatus = useAgentsStore((s) => s.loadAgentStatus);
  const devices = useDevicesStore((s) => s.devices);
  const refreshDevices = useDevicesStore((s) => s.refreshDevices);
  const sayInHuddle = useHuddleStore((s) => s.sayInHuddle);
  const hasDevice = panes.includes("device");
  // Wide enough for both at once: the device and the room chat stop being
  // panes you switch to and become tabs in a side panel, as on the Mac.
  const isWide = useIsWide();
  const splitDevice = isWide && hasDevice;
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<SidePanelId>(
    hasDevice ? "device" : "chat",
  );
  const shownTab: SidePanelId = hasDevice ? panelTab : "chat";
  const chatInView = isWide
    ? panelOpen && shownTab === "chat"
    : pane === "chat";
  const unread = useUnreadCount(view.chat.length, chatInView);
  const onPanelResize = useCallback((w: number) => saveSidePanelWidth(w), []);
  const lastMessage = view.chat[view.chat.length - 1];

  useEffect(() => {
    if (connection === "ready" && agentId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [connection, agentId, loadAgentStatus]);

  // Keyed on the device itself, not just "has one": the host can swap the room
  // onto another simulator mid-huddle, and the list has to follow.
  useEffect(() => {
    if (connection === "ready" && hasDevice) {
      refreshDevices({ background: true }).catch(() => {});
    }
  }, [connection, hasDevice, view.deviceKey, refreshDevices]);

  // Nothing to show on the device pane — the host closed it, or it moved into
  // its own panel beside us.
  useEffect(() => {
    if (!hasDevice || splitDevice) {
      setPane((p) => (p === "device" ? "agent" : p));
    }
  }, [hasDevice, splitDevice]);

  // A column now holds the chat, so it's no longer a pane to switch to.
  useEffect(() => {
    if (isWide) {
      setPane((p) => (p === "chat" ? "agent" : p));
    }
  }, [isWide]);

  // Someone else speaking brings a hidden panel back on the chat. An open one
  // keeps its tab — yanking the device away mid-tap is worse than a badge.
  const lastFromOthers =
    lastMessage && lastMessage.member_id !== view.you ? lastMessage.id : null;
  const handledMessage = useRef(lastFromOthers);
  useEffect(() => {
    if (!lastFromOthers || handledMessage.current === lastFromOthers) {
      return;
    }
    handledMessage.current = lastFromOthers;
    if (!panelOpen) {
      setPanelOpen(true);
      setPanelTab("chat");
    }
  }, [lastFromOthers, panelOpen]);

  // The list is already scoped to the room, so this is the device or nothing.
  const device = devices.find((d) => d.id === view.deviceKey) ?? null;
  const title = status?.title?.trim() || "Shared agent";

  // The tab reads as the shared agent, not as a generic remote.
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · Argus`;

    return () => {
      document.title = previous;
    };
  }, [title]);

  return (
    <div className="aw-shell aw-shell-fluid">
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
            <SidebarHeaderAction
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Settings"
            >
              <Icons.GearIcon size={14} />
            </SidebarHeaderAction>
            <SidebarHeaderAction
              onClick={() => setPeopleOpen((open) => !open)}
              title="People in this huddle"
              aria-label="People in this huddle"
            >
              <Icons.GuestsIcon size={14} />
              {view.members.length > 1 && (
                <span className="aw-people-count">{view.members.length}</span>
              )}
            </SidebarHeaderAction>
            <SidebarHeaderAction
              onClick={() => {
                if (!isWide) {
                  setPane(pane === "chat" ? "agent" : "chat");
                } else if (chatInView) {
                  setPanelOpen(false);
                } else {
                  setPanelOpen(true);
                  setPanelTab("chat");
                }
              }}
              title="Chat with the room"
              aria-label="Chat with the room"
            >
              <Icons.ChatIcon size={14} />
              {unread > 0 && <span className="aw-people-count">{unread}</span>}
            </SidebarHeaderAction>
            {hasDevice && !splitDevice && (
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

      {peopleOpen && (
        <div className="aw-people">
          <GuestList
            emptyLabel="Just you so far."
            guests={view.members.map((m) => ({
              id: m.member_id,
              label: m.member_id === view.you ? `${m.label} (you)` : m.label,
              state: "approved" as const,
              connected: m.connected,
              driving: m.driving,
              typing: m.typing,
            }))}
          />
          <Button variant="danger" onClick={leaveHuddle}>
            Leave huddle
          </Button>
        </div>
      )}

      <div
        className="aw-huddle-body"
      >
        <div className="aw-pane">
          <div className="aw-main">
            {pane === "agent" && (
              <AgentTranscript agentId={agentId} messageMenu={false} />
            )}
            {pane === "chat" && (
              <RoomChat view={view} onSend={sayInHuddle} />
            )}
            {pane === "device" && <DevicePane device={device} />}
          </div>

          {pane === "agent" && (
            <div className="aw-chat-dock">
              {/* Always present, so the composer doesn't jump when it fills. */}
              <div className="aw-typing">
                <TypingIndicator names={typingNames(view)} />
              </div>
              <ChatInput agentId={agentId} sessionId={status?.session_id} />
            </div>
          )}
        </div>

        {isWide && (
          <ResizablePanel
            collapsed={!panelOpen}
            defaultWidth={loadSidePanelWidth()}
            maxWidth={900}
            minWidth={280}
            side="right"
            unit="pixel"
            onResize={onPanelResize}
          >
            <div className="aw-huddle-panel">
              <SidePanel<SidePanelId>
              selectedId={shownTab}
              tabs={sidePanelTabs(hasDevice, shownTab === "chat" ? 0 : unread)}
              onClose={() => setPanelOpen(false)}
              onSelect={setPanelTab}
            >
              {shownTab === "device" ? (
                <DevicePane device={device} />
              ) : (
                <RoomChat view={view} onSend={sayInHuddle} />
              )}
              </SidePanel>
            </div>
          </ResizablePanel>
        )}
      </div>

      {settingsOpen && (
        <HuddleSettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

type SidePanelId = "chat" | "device";

function sidePanelTabs(
  hasDevice: boolean,
  unread: number,
): SidePanelTab<SidePanelId>[] {
  const chat: SidePanelTab<SidePanelId> = {
    id: "chat",
    title: "Chat",
    icon: <Icons.ChatIcon size={13} />,
    count: unread,
  };
  if (!hasDevice) {
    return [chat];
  }

  return [
    {
      id: "device",
      title: "Device",
      icon: <Icons.SimulatorIcon size={13} />,
    },
    chat,
  ];
}

/** The side conversation between the people in the room. */
function RoomChat({
  view,
  onSend,
}: {
  view: HuddleView;
  onSend: (text: string) => void;
}) {
  return (
    <HuddleChat
      emptyLabel="Nothing said yet. This stays between the people here — the agent never sees it."
      messages={view.chat.map((m) => ({
        id: m.id,
        author: m.author,
        text: m.text,
        at: m.at,
        mine: m.member_id != null && m.member_id === view.you,
      }))}
      onSend={onSend}
    />
  );
}

/** The shared device, or the wait for it to show up. */
function DevicePane({ device }: { device: RemoteDevice | null }) {
  if (!device) {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Waiting for the device…</span>
      </div>
    );
  }

  return (
    <DeviceScreen
      deviceId={device.id}
      isTv={device.is_tv}
      platform={device.platform}
    />
  );
}

/**
 * The only thing a guest owns in a huddle: their name. Saving re-presents the
 * room token on the same key, so the host sees the new name immediately and
 * nobody is asked to approve anyone again.
 */
function HuddleSettingsDialog({ onClose }: { onClose: () => void }) {
  const renameInHuddle = useHuddleStore((s) => s.renameInHuddle);
  const [name, setName] = useState(readGuestLabel);
  const dirty = name.trim().length > 0 && name.trim() !== readGuestLabel();
  const save = () => {
    renameInHuddle(name.trim());
    onClose();
  };

  return (
    <Dialog title="Settings" titleId="huddle-settings" onClose={onClose}>
      <DialogBody>
        <SettingsScreenField
          label="Your name"
          caption="What the host and everyone else in the huddle see."
        >
          <Input
            autoFocus
            maxLength={60}
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty) {
                save();
              }
            }}
          />
        </SettingsScreenField>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!dirty} onClick={save}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
