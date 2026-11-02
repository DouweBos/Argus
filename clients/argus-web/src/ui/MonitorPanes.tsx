/**
 * The pane bodies behind the monitor shell. A pane is a sticky top bar, a
 * scrolling body and (for an agent) a docked composer — the same three parts
 * whether it is the only pane on a phone or one of two on a tablet. Which
 * screen each pane shows comes from the URL (`routing/`).
 */

import { useEffect, useRef, useState } from "react";
import {
  ConfirmDialog,
  Icons,
  SidebarHeader,
  SidebarHeaderAction,
} from "@argus/peacock";
import { openAgent } from "../routing/open";
import { appNavigate } from "../routing/router";
import {
  pathForScreen,
  projectScreen,
  type Screen,
} from "../routing/screens";
import { useAgentsStore } from "../stores/agents";
import { useConnectionStore } from "../stores/connection";
import { useDevicesStore } from "../stores/devices";
import { useProjectsStore } from "../stores/projects";
import { AgentTranscript } from "./transcript/AgentTranscript";
import { AutomationScreen } from "./automations/AutomationScreen";
import { AutomationsScreen } from "./automations/AutomationsScreen";
import { DescribeScreen } from "./automations/DescribeScreen";
import { InboxScreen } from "./automations/InboxScreen";
import { ProposalScreen } from "./automations/ProposalScreen";
import { QuickRunScreen } from "./automations/QuickRunScreen";
import { RunScreen } from "./automations/RunScreen";
import { useInboxBadge } from "./automations/useInbox";
import { ChangesView } from "./ChangesView";
import { ChatInput } from "./ChatInput";
import { ConnectionBadge } from "./ConnectionBadge";
import { DevicesView } from "./DevicesView";
import { McpServersDialog } from "./McpServersDialog";
import { Projects } from "./ProjectViews";
import { DeviceRoute, ProjectRoute, SessionRedirect } from "./ScreenRoutes";
import { useScreenTitle } from "./screenTitle";
import { LazySessionTool, SessionToolActions } from "./SessionToolActions";
import { Settings } from "./Settings";
import { SavedChat } from "./start/SavedChat";
import { SessionHome } from "./start/SessionHome";
import { useScrollRestore } from "./useScrollRestore";

/** Where master-pane navigation goes: the URL, or the pane alone while a detail is open. */
type GoMaster = (screen: Screen) => void;

function Pane({
  actions,
  banner,
  children,
  dock,
  leading,
  screen,
}: {
  actions?: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
  dock?: React.ReactNode;
  leading: React.ReactNode;
  screen: Screen;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const title = useScreenTitle(screen);
  useScrollRestore(mainRef, pathForScreen(screen), screen.name !== "agent");

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

function ScreenBody({
  goMaster = appNavigate,
  screen,
}: {
  goMaster?: GoMaster;
  screen: Screen;
}) {
  switch (screen.name) {
    case "projects":
      return (
        <Projects
          onOpen={(repoRoot) => goMaster(projectScreen(repoRoot))}
          onOpenAgent={(agent) => openAgent(agent)}
        />
      );
    case "project":
      return (
        <ProjectRoute
          projectKey={screen.projectKey}
          onOpenAgent={(agent) => openAgent(agent)}
          onOpenChanges={(sessionId) =>
            appNavigate({ name: "changes", sessionId, mode: "branch" })
          }
        />
      );
    case "session":
      return <SessionRedirect sessionId={screen.sessionId} />;
    case "sessionHome":
      return <SessionHome sessionId={screen.sessionId} />;
    case "chat":
      return (
        <SavedChat historyId={screen.historyId} sessionId={screen.sessionId} />
      );
    case "agent":
      return <AgentTranscript agentId={screen.agentId} />;
    case "changes":
      return (
        <ChangesView
          sessionId={screen.sessionId}
          mode={screen.mode}
          onModeChange={(mode) =>
            appNavigate({ ...screen, mode }, { replace: true })
          }
        />
      );
    case "devices":
      return (
        <DevicesView
          onOpen={(d) =>
            appNavigate({
              name: "device",
              platform: d.platform,
              deviceKey: d.id,
            })
          }
        />
      );
    case "device":
      return (
        <DeviceRoute platform={screen.platform} deviceKey={screen.deviceKey} />
      );
    case "settings":
      return <Settings />;
    case "files":
    case "file":
    case "search":
    case "terminals":
    case "fileDiff":
      return <LazySessionTool screen={screen} />;
    case "inbox":
      return <InboxScreen />;
    case "proposal":
      return <ProposalScreen proposalId={screen.proposalId} />;
    case "automations":
      return <AutomationsScreen />;
    case "automation":
      return (
        <AutomationScreen
          automationId={screen.automationId}
          key={screen.automationId}
        />
      );
    case "automationRun":
      return (
        <RunScreen
          parent={{ name: "automation", automationId: screen.automationId }}
          runId={screen.runId}
        />
      );
    case "quickRun":
      return <QuickRunScreen />;
    case "quickRunDetail":
      return <RunScreen parent={{ name: "quickRun" }} runId={screen.runId} />;
    case "describe":
      return <DescribeScreen />;
  }
}

/**
 * The top-left of the root list: the logo, or for an account computer opened
 * from the hosted client, the way back to the account's computers.
 */
function RootLeading() {
  const account = useConnectionStore((s) => s.identity?.account);
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
function RootActions() {
  const connection = useConnectionStore((s) => s.connection);
  const refreshProjects = useProjectsStore((s) => s.refreshProjects);
  const waiting = useInboxBadge();

  return (
    <>
      <SidebarHeaderAction
        className="aw-badged"
        onClick={() => appNavigate({ name: "inbox" })}
        title={waiting > 0 ? `Inbox — ${waiting} waiting` : "Inbox"}
        aria-label={waiting > 0 ? `Inbox, ${waiting} waiting` : "Inbox"}
      >
        <Icons.EnvelopeIcon size={14} />
        {waiting > 0 && <span className="aw-badge-count">{waiting}</span>}
      </SidebarHeaderAction>
      <SidebarHeaderAction
        onClick={() => appNavigate({ name: "automations" })}
        title="Automations"
        aria-label="Automations"
      >
        <Icons.ClockIcon size={14} />
      </SidebarHeaderAction>
      <SidebarHeaderAction
        onClick={() => appNavigate({ name: "devices" })}
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
        onClick={() => appNavigate({ name: "settings" })}
        title="Settings"
        aria-label="Settings"
      >
        <Icons.GearIcon size={14} />
      </SidebarHeaderAction>
    </>
  );
}

/** Pin the agent so the computer resumes it on restart, or unpin it. */
function PinAction({ agentId }: { agentId: string }) {
  const status = useAgentsStore((s) => s.statusByAgent[agentId]);
  const setPinned = useAgentsStore((s) => s.setPinned);
  if (!status) {
    return null;
  }
  const pinned = status.pinned === true;
  // Pinning needs the agent live; unpinning works on one already stopped.
  if (!pinned && (status.status === "stopped" || status.status === "error")) {
    return null;
  }
  const label = pinned
    ? "Unpin: stop resuming it when the computer restarts"
    : "Pin: resume it when the computer restarts";

  return (
    <SidebarHeaderAction
      aria-label={label}
      aria-pressed={pinned}
      className={pinned ? "aw-action-on" : undefined}
      title={label}
      onClick={() => {
        setPinned(agentId, !pinned).catch(() => {});
      }}
    >
      <Icons.PinIcon size={14} />
    </SidebarHeaderAction>
  );
}

/** Jump to the agent's device and changes, or stop it outright. */
function AgentActions({
  agentId,
  onStopped,
  sessionId,
}: {
  agentId: string;
  onStopped: () => void;
  sessionId: string;
}) {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const devices = useDevicesStore((s) => s.devices);
  const stopAgentProcess = useAgentsStore((s) => s.stopAgentProcess);
  const [confirmingStop, setConfirmingStop] = useState(false);
  const [showingMcp, setShowingMcp] = useState(false);

  return (
    <>
      <SidebarHeaderAction
        onClick={() => appNavigate({ name: "sessionHome", sessionId })}
        title="New agent and recent chats"
        aria-label="New agent and recent chats"
      >
        <Icons.HistoryIcon size={14} />
      </SidebarHeaderAction>
      {hasControl && <PinAction agentId={agentId} />}
      <SidebarHeaderAction
        onClick={() => setShowingMcp(true)}
        title="MCP servers"
        aria-label="MCP servers"
      >
        <Icons.SlidersIcon size={14} />
      </SidebarHeaderAction>
      <SidebarHeaderAction
        onClick={() => {
          const only = devices.length === 1 ? devices[0] : null;
          appNavigate(
            only
              ? { name: "device", platform: only.platform, deviceKey: only.id }
              : { name: "devices" },
          );
        }}
        title="Devices"
        aria-label="Devices"
      >
        <Icons.SimulatorIcon size={14} />
      </SidebarHeaderAction>
      <SidebarHeaderAction
        onClick={() => appNavigate({ name: "changes", sessionId, mode: "branch" })}
        title="View changes"
        aria-label="View changes"
      >
        <Icons.BranchIcon size={14} />
      </SidebarHeaderAction>
      {hasControl && (
        <SidebarHeaderAction
          onClick={() => setConfirmingStop(true)}
          title="Stop agent"
          aria-label="Stop agent"
        >
          <Icons.StopIcon size={14} />
        </SidebarHeaderAction>
      )}
      {showingMcp && (
        <McpServersDialog
          agentId={agentId}
          onClose={() => setShowingMcp(false)}
        />
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
  const hasControl = useConnectionStore((s) => s.hasControl());
  const sessionId = useAgentsStore((s) => s.statusByAgent[agentId]?.session_id);
  const loadAgentStatus = useAgentsStore((s) => s.loadAgentStatus);

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

function agentChrome(screen: Screen, onStopped: () => void) {
  if (screen.name !== "agent") {
    return { actions: <SessionToolActions screen={screen} />, dock: null };
  }

  return {
    actions: (
      <>
        <SessionToolActions screen={screen} />
        <AgentActions
          agentId={screen.agentId}
          sessionId={screen.sessionId}
          onStopped={onStopped}
        />
      </>
    ),
    dock: <AgentDock agentId={screen.agentId} />,
  };
}

/** Phone layout: the screen the URL names, and nothing else. */
export function SinglePane({
  banner,
  onBack,
  screen,
}: {
  banner: React.ReactNode;
  onBack: () => void;
  screen: Screen;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const atRoot = screen.name === "projects";
  const agent = agentChrome(screen, onBack);

  return (
    <Pane
      banner={banner}
      screen={screen}
      leading={
        atRoot ? (
          <RootLeading />
        ) : (
          <SidebarHeaderAction onClick={onBack} title="Back" aria-label="Back">
            <Icons.ChevronLeftIcon size={14} />
          </SidebarHeaderAction>
        )
      }
      actions={
        <>
          <ConnectionBadge state={connection} />
          {agent.actions}
          {atRoot && <RootActions />}
        </>
      }
      dock={agent.dock}
    >
      <ScreenBody screen={screen} />
    </Pane>
  );
}

/** Tablet left pane: the project list, or a project you drilled into. */
export function MasterPane({
  banner,
  goMaster,
  screen,
}: {
  banner: React.ReactNode;
  goMaster: GoMaster;
  screen: Screen;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const atRoot = screen.name === "projects";

  return (
    <Pane
      banner={banner}
      screen={screen}
      leading={
        atRoot ? (
          <RootLeading />
        ) : (
          <SidebarHeaderAction
            onClick={() => goMaster({ name: "projects" })}
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
          {atRoot && <RootActions />}
        </>
      }
    >
      <ScreenBody goMaster={goMaster} screen={screen} />
    </Pane>
  );
}

/** Tablet right pane: the agent, device, diff or settings screen in focus. */
export function DetailPane({
  onClose,
  screen,
}: {
  onClose: () => void;
  screen: Screen;
}) {
  const agent = agentChrome(screen, onClose);

  return (
    <Pane
      screen={screen}
      leading={<PaneIcon screen={screen} />}
      actions={
        <>
          {agent.actions}
          <SidebarHeaderAction
            onClick={onClose}
            title="Close"
            aria-label="Close"
          >
            <Icons.CloseIcon size={14} />
          </SidebarHeaderAction>
        </>
      }
      dock={agent.dock}
    >
      <ScreenBody screen={screen} />
    </Pane>
  );
}

function PaneIcon({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "changes":
    case "fileDiff":
      return <Icons.BranchIcon size={14} />;
    case "files":
    case "file":
      return <Icons.CodeIcon size={14} />;
    case "search":
      return <Icons.SearchIcon size={14} />;
    case "terminals":
      return <Icons.TerminalIcon size={14} />;
    case "devices":
    case "device":
      return <Icons.SimulatorIcon size={14} />;
    case "settings":
      return <Icons.GearIcon size={14} />;
    case "chat":
      return <Icons.HistoryIcon size={14} />;
    case "inbox":
    case "proposal":
      return <Icons.EnvelopeIcon size={14} />;
    case "automations":
    case "automation":
    case "automationRun":
    case "quickRun":
    case "quickRunDetail":
    case "describe":
      return <Icons.ClockIcon size={14} />;
    default:
      return <Icons.AgentIcon size={14} />;
  }
}
