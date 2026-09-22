/**
 * The guest client for a `#/huddle/<token>` link.
 *
 * Single-agent by construction: the room names one agent and one device, and
 * this screen renders those two and nothing else — no projects, no sessions,
 * no agent switcher. The host refuses everything outside the room anyway; the
 * UI simply never offers it.
 */

import { useEffect, useRef, useState } from "react";
import {
  Button,
  GuestList,
  HuddleChat,
  Icons,
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
  const leaveHuddle = useAppStore((s) => s.leaveHuddle);
  const connection = useAppStore((s) => s.connection);
  const status = useAppStore((s) => s.statusByAgent[agentId]);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);
  const devices = useAppStore((s) => s.devices);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const sayInHuddle = useAppStore((s) => s.sayInHuddle);
  const hasDevice = panes.includes("device");
  const unread = useUnreadCount(view.chat.length, pane === "chat");

  useEffect(() => {
    if (connection === "ready" && agentId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [connection, agentId, loadAgentStatus]);

  // Keyed on the device itself, not just "has one": the host can swap the room
  // onto another simulator mid-huddle, and the list has to follow.
  useEffect(() => {
    if (connection === "ready" && hasDevice) {
      refreshDevices().catch(() => {});
    }
  }, [connection, hasDevice, view.deviceKey, refreshDevices]);

  // The host closed the device out from under us — don't strand the guest on a
  // pane that no longer has anything to show.
  useEffect(() => {
    if (!hasDevice) {
      setPane("agent");
    }
  }, [hasDevice]);

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
              onClick={() => setPane(pane === "chat" ? "agent" : "chat")}
              title="Chat with the room"
              aria-label="Chat with the room"
            >
              <Icons.ChatIcon size={14} />
              {unread > 0 && <span className="aw-people-count">{unread}</span>}
            </SidebarHeaderAction>
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

      <div className="aw-main">
        {pane === "agent" && <AgentTranscript agentId={agentId} />}
        {pane === "chat" && (
          <HuddleChat
            emptyLabel="Nothing said yet. This stays between the people here — the agent never sees it."
            messages={view.chat.map((m) => ({
              id: m.id,
              author: m.author,
              text: m.text,
              at: m.at,
              mine: m.member_id != null && m.member_id === view.you,
            }))}
            onSend={sayInHuddle}
          />
        )}
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
          {/* Always present, so the composer doesn't jump when it fills. */}
          <div className="aw-typing">
            <TypingIndicator names={typingNames(view)} />
          </div>
          <ChatInput agentId={agentId} sessionId={status?.session_id} />
        </div>
      )}
    </div>
  );
}
