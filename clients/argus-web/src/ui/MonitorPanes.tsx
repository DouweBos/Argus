/**
 * The pane bodies behind the monitor shell. A pane is a sticky top bar, a
 * scrolling body and (for an agent) a docked composer — the same three parts
 * whether it is the only pane on a phone or one of two on a tablet.
 */

import { useEffect, useRef, useState } from "react";
import {
  ConfirmDialog,
  Icons,
  SidebarHeader,
  SidebarHeaderAction,
} from "@argus/peacock";
import { useAppStore } from "../lib/store";
import { AgentTranscript } from "./AgentTranscript";
import { ChangesView } from "./ChangesView";
import { ChatInput } from "./ChatInput";
import { ConnectionBadge } from "./ConnectionBadge";
import { DevicesView } from "./DevicesView";
import { DeviceScreen } from "./DeviceScreen";
import { Project, Projects } from "./ProjectViews";
import { Settings } from "./Settings";
import { useScrollRestore } from "./useScrollRestore";
import type { View } from "./useHistoryView";

type Push = (view: View) => void;

export function headingFor(view: View): string {
  switch (view.name) {
    case "projects":
      return "Projects";
    case "project":
      return view.projectName;
    case "settings":
      return "Settings";
    case "changes":
      return `Changes · ${view.label}`;
    case "devices":
      return "Devices";
    case "device":
      return view.deviceName;
    default:
      return view.agentLabel;
  }
}

/** Identity of the view for scroll memory — same screen, same key. */
function viewKey(view: View): string {
  switch (view.name) {
    case "project":
      return `project:${view.repoRoot}`;
    case "agent":
      return `agent:${view.agentId}`;
    case "changes":
      return `changes:${view.sessionId}`;
    case "device":
      return `device:${view.deviceId}`;
    default:
      return view.name;
  }
}

function Pane({
  actions,
  banner,
  children,
  dock,
  leading,
  title,
  view,
}: {
  actions?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
  dock?: React.ReactNode;
  leading: React.ReactNode;
  title: string;
  view: View;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  useScrollRestore(mainRef, viewKey(view), view.name !== "agent");

  return (
    <div className="aw-pane">
      <SidebarHeader
        className="aw-topbar"
        brand={
          <>
            {leading}
            <span className="aw-topbar-title" title={title}>
              {title}
            </span>
          </>
        }
        actions={actions}
      />
      <div className="aw-main" ref={mainRef}>
        {banner}
        {children}
      </div>
      {dock}
    </div>
  );
}

function ViewBody({ push, view }: { push: Push; view: View }) {
  switch (view.name) {
    case "projects":
      return (
        <Projects
          onOpen={(repoRoot, projectName) =>
            push({ name: "project", repoRoot, projectName })
          }
          onOpenAgent={(agentId, agentLabel) =>
            push({ name: "agent", agentId, agentLabel })
          }
        />
      );
    case "project":
      return (
        <Project
          repoRoot={view.repoRoot}
          onOpenAgent={(agentId, agentLabel) =>
            push({ name: "agent", agentId, agentLabel })
          }
          onOpenChanges={(sessionId, label) =>
            push({ name: "changes", sessionId, label })
          }
        />
      );
    case "agent":
      return <AgentTranscript agentId={view.agentId} />;
    case "changes":
      return <ChangesView sessionId={view.sessionId} />;
    case "devices":
      return (
        <DevicesView
          onOpen={(d) =>
            push({
              name: "device",
              deviceId: d.id,
              platform: d.platform,
              deviceName: d.name,
              isTv: d.is_tv,
            })
          }
        />
      );
    case "device":
      return (
        <DeviceScreen
          deviceId={view.deviceId}
          platform={view.platform}
          isTv={view.isTv}
        />
      );
    default:
      return <Settings />;
  }
}

/**
 * The top-left of the root list: the logo, or for an account computer opened
 * from the hosted client, the way back to the account's computers.
 */
function RootLeading() {
  const account = useAppStore((s) => s.identity?.account);
  if (!account) {
    return <Icons.ArgusLogo size={16} />;
  }

  return (
    <SidebarHeaderAction
      onClick={account.leave}
      title="Computers"
      aria-label="Computers"
    >
      <Icons.ChevronLeftIcon size={14} />
    </SidebarHeaderAction>
  );
}

/** Devices / refresh / settings — the actions that belong to the project list. */
function RootActions({ push }: { push: Push }) {
  const connection = useAppStore((s) => s.connection);
  const refreshProjects = useAppStore((s) => s.refreshProjects);

  return (
    <>
      <SidebarHeaderAction
        onClick={() => push({ name: "devices" })}
        title="Devices"
        aria-label="Devices"
      >
        <Icons.SimulatorIcon size={14} />
      </SidebarHeaderAction>
      <SidebarHeaderAction
        onClick={() => refreshProjects().catch(() => {})}
        title="Refresh"
        aria-label="Refresh"
        disabled={connection !== "ready"}
      >
        <Icons.RefreshIcon size={14} />
      </SidebarHeaderAction>
      <SidebarHeaderAction
        onClick={() => push({ name: "settings" })}
        title="Settings"
        aria-label="Settings"
      >
        <Icons.GearIcon size={14} />
      </SidebarHeaderAction>
    </>
  );
}

/** Jump to the agent's device and changes, or stop it outright. */
function AgentActions({
  agentId,
  agentLabel,
  onStopped,
  push,
}: {
  agentId: string;
  agentLabel: string;
  onStopped: () => void;
  push: Push;
}) {
  const hasControl = useAppStore((s) => s.hasControl());
  const devices = useAppStore((s) => s.devices);
  const stopAgentProcess = useAppStore((s) => s.stopAgentProcess);
  const sessionId = useAppStore((s) => s.statusByAgent[agentId]?.session_id);
  const [confirmingStop, setConfirmingStop] = useState(false);

  return (
    <>
      <SidebarHeaderAction
        onClick={() => {
          const only = devices.length === 1 ? devices[0] : null;
          push(
            only
              ? {
                  name: "device",
                  deviceId: only.id,
                  platform: only.platform,
                  deviceName: only.name,
                  isTv: only.is_tv,
                }
              : { name: "devices" },
          );
        }}
        title="Devices"
        aria-label="Devices"
      >
        <Icons.SimulatorIcon size={14} />
      </SidebarHeaderAction>
      {sessionId && (
        <SidebarHeaderAction
          onClick={() =>
            push({ name: "changes", sessionId, label: agentLabel })
          }
          title="View changes"
          aria-label="View changes"
        >
          <Icons.BranchIcon size={14} />
        </SidebarHeaderAction>
      )}
      {hasControl && (
        <SidebarHeaderAction
          onClick={() => setConfirmingStop(true)}
          title="Stop agent"
          aria-label="Stop agent"
        >
          <Icons.StopIcon size={14} />
        </SidebarHeaderAction>
      )}
      {confirmingStop && (
        <ConfirmDialog
          destructive
          confirmLabel="Stop agent"
          title="Stop this agent?"
          titleId="aw-stop-agent"
          onCancel={() => setConfirmingStop(false)}
          onConfirm={() =>
            stopAgentProcess(agentId)
              .then(() => {
                setConfirmingStop(false);
                onStopped();
              })
              .catch(() => setConfirmingStop(false))
          }
        >
          It stops mid-turn and anything still queued for it is discarded.
        </ConfirmDialog>
      )}
    </>
  );
}

/** The control-only chat input, pinned below the transcript scroll area. */
function AgentDock({ agentId }: { agentId: string }) {
  const hasControl = useAppStore((s) => s.hasControl());
  const sessionId = useAppStore((s) => s.statusByAgent[agentId]?.session_id);
  const loadAgentStatus = useAppStore((s) => s.loadAgentStatus);

  useEffect(() => {
    if (!sessionId) {
      loadAgentStatus(agentId).catch(() => {});
    }
  }, [agentId, sessionId, loadAgentStatus]);

  if (!hasControl) {
    return null;
  }

  return (
    <div className="aw-chat-dock">
      <ChatInput agentId={agentId} sessionId={sessionId} />
    </div>
  );
}

/** Phone layout: whatever sits on top of the history stack, and nothing else. */
export function SinglePane({
  banner,
  canGoBack,
  onBack,
  push,
  view,
}: {
  banner: React.ReactNode;
  canGoBack: boolean;
  onBack: () => void;
  push: Push;
  view: View;
}) {
  const connection = useAppStore((s) => s.connection);

  return (
    <Pane
      banner={banner}
      title={headingFor(view)}
      view={view}
      leading={
        canGoBack ? (
          <SidebarHeaderAction onClick={onBack} title="Back" aria-label="Back">
            <Icons.ChevronLeftIcon size={14} />
          </SidebarHeaderAction>
        ) : (
          <RootLeading />
        )
      }
      actions={
        <>
          <ConnectionBadge state={connection} />
          {view.name === "agent" && (
            <AgentActions
              agentId={view.agentId}
              agentLabel={view.agentLabel}
              onStopped={onBack}
              push={push}
            />
          )}
          {!canGoBack && <RootActions push={push} />}
        </>
      }
      dock={view.name === "agent" && <AgentDock agentId={view.agentId} />}
    >
      <ViewBody push={push} view={view} />
    </Pane>
  );
}

/** Tablet left pane: the project list, or a project you drilled into. */
export function MasterPane({
  banner,
  push,
  view,
}: {
  banner: React.ReactNode;
  push: Push;
  view: View;
}) {
  const connection = useAppStore((s) => s.connection);
  const atRoot = view.name === "projects";

  return (
    <Pane
      banner={banner}
      title={headingFor(view)}
      view={view}
      leading={
        atRoot ? (
          <RootLeading />
        ) : (
          // Pushing rather than popping: the detail pane must stay put.
          <SidebarHeaderAction
            onClick={() => push({ name: "projects" })}
            title="All projects"
            aria-label="All projects"
          >
            <Icons.ChevronLeftIcon size={14} />
          </SidebarHeaderAction>
        )
      }
      actions={
        <>
          <ConnectionBadge state={connection} />
          {atRoot && <RootActions push={push} />}
        </>
      }
    >
      <ViewBody push={push} view={view} />
    </Pane>
  );
}

/** Tablet right pane: the agent, device, diff or settings screen in focus. */
export function DetailPane({
  onClose,
  push,
  view,
}: {
  onClose: () => void;
  push: Push;
  view: View;
}) {
  return (
    <Pane
      title={headingFor(view)}
      view={view}
      leading={<PaneIcon view={view} />}
      actions={
        <>
          {view.name === "agent" && (
            <AgentActions
              agentId={view.agentId}
              agentLabel={view.agentLabel}
              onStopped={onClose}
              push={push}
            />
          )}
          <SidebarHeaderAction
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <Icons.CloseIcon size={14} />
          </SidebarHeaderAction>
        </>
      }
      dock={view.name === "agent" && <AgentDock agentId={view.agentId} />}
    >
      <ViewBody push={push} view={view} />
    </Pane>
  );
}

function PaneIcon({ view }: { view: View }) {
  switch (view.name) {
    case "changes":
      return <Icons.BranchIcon size={14} />;
    case "devices":
    case "device":
      return <Icons.SimulatorIcon size={14} />;
    case "settings":
      return <Icons.GearIcon size={14} />;
    default:
      return <Icons.AgentIcon size={14} />;
  }
}

