/**
 * What fills the window's centre: the screen the URL names, the agent's
 * toolbar actions and its docked composer. The chrome around them (sidebar,
 * toolbar, side panel) is `Monitor` and `shell/`.
 */

import { useEffect, useState } from "react";
import { ConfirmDialog, FlatIconButton, Icons } from "@argus/peacock";
import { openAgent } from "../routing/open";
import { appNavigate } from "../routing/router";
import { projectScreen, type Screen } from "../routing/screens";
import { useAgentsStore } from "../stores/agents";
import { useConnectionStore } from "../stores/connection";
import { AgentTranscript } from "./transcript/AgentTranscript";
import { AutomationScreen } from "./automations/AutomationScreen";
import { AutomationsScreen } from "./automations/AutomationsScreen";
import { DescribeScreen } from "./automations/DescribeScreen";
import { InboxScreen } from "./automations/InboxScreen";
import { ProposalScreen } from "./automations/ProposalScreen";
import { QuickRunScreen } from "./automations/QuickRunScreen";
import { RunScreen } from "./automations/RunScreen";
import { ChangesView } from "./ChangesView";
import { ChatInput } from "./ChatInput";
import { LazyIssuesScreen } from "./issues/LazyIssuesScreen";
import { LazyDesignScreen } from "./design/LazyDesignScreen";
import { DevicesView } from "./DevicesView";
import { Projects } from "./ProjectViews";
import { DeviceRoute, ProjectRoute, SessionRedirect } from "./ScreenRoutes";
import { NotificationsView } from "./NotificationsView";
import {
  LazyBrowserScreen,
  LazySessionTool,
  LazyShipScreen,
} from "./SessionToolActions";
import { Settings, SettingsPageScreen } from "./Settings";
import { UsageView } from "./UsageView";
import { SavedChat } from "./start/SavedChat";
import { SessionHome } from "./start/SessionHome";

export function ScreenBody({ screen }: { screen: Screen }) {
  switch (screen.name) {
    case "projects":
      return (
        <Projects
          onOpen={(repoRoot) => appNavigate(projectScreen(repoRoot))}
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
    case "settingsPage":
      return <SettingsPageScreen page={screen.page} />;
    case "usage":
      return <UsageView range={screen.range} tab={screen.tab} />;
    case "notifications":
      return <NotificationsView />;
    case "design":
      return <LazyDesignScreen screen={screen} />;
    case "issues":
      return <LazyIssuesScreen screen={screen} />;
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
    case "browser":
      return <LazyBrowserScreen sessionId={screen.sessionId} />;
    case "branches":
    case "branch":
    case "compare":
    case "stashes":
    case "commit":
    case "pullRequests":
    case "pullRequest":
      return <LazyShipScreen screen={screen} />;
  }
}


/**
 * Stop the agent outright. Its devices, changes, MCP servers, pin and recent
 * chats live in the session's context card and tabs.
 */
export function AgentActions({
  agentId,
  onStopped,
}: {
  agentId: string;
  onStopped: () => void;
}) {
  const hasControl = useConnectionStore((s) => s.hasControl());
  const stopAgentProcess = useAgentsStore((s) => s.stopAgentProcess);
  const [confirmingStop, setConfirmingStop] = useState(false);

  return (
    <>
      {hasControl && (
        <FlatIconButton
          icon={<Icons.StopIcon size={13} />}
          label="Stop agent"
          onClick={() => setConfirmingStop(true)}
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
export function AgentDock({ agentId }: { agentId: string }) {
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
