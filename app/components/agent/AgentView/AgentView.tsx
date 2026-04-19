import { useCallback, useMemo } from "react";
import { Icons } from "@argus/peacock";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { isWorkspaceReady } from "../../../lib/types";
import {
  setActiveAgent,
  setSecondaryAgent,
  setSplitEnabled,
  useSplitState,
} from "../../../stores/agentStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { AgentChat } from "../AgentChat";
import { AgentTabBar } from "../AgentTabBar";
import { HomePanel } from "../HomePanel";
import { SplitAgentPanes } from "../SplitAgentPanes";
import styles from "./AgentView.module.css";

interface AgentViewProps {
  workspaceId: string;
}

export function AgentView({ workspaceId }: AgentViewProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const { agents, activeAgent, startNew, stopAgent, restartAgent, setActive } =
    useWorkspaceAgents(workspaceId, {
      autoStart: false,
      workspaceReady: workspace ? isWorkspaceReady(workspace.status) : false,
    });

  const isHomeActive = !activeAgent;
  const { splitEnabled, secondaryAgentId } = useSplitState(workspaceId);

  const toggleSplit = useCallback(() => {
    setSplitEnabled(workspaceId, !splitEnabled);
  }, [workspaceId, splitEnabled]);

  const handleSelect = useCallback(
    (agentId: string, e?: { altKey?: boolean; metaKey?: boolean }) => {
      if (splitEnabled && (e?.altKey || e?.metaKey)) {
        if (activeAgent && agentId !== activeAgent.agent_id) {
          setSecondaryAgent(workspaceId, agentId);
        }

        return;
      }
      setActive(agentId);
    },
    [splitEnabled, activeAgent, workspaceId, setActive],
  );

  const showSplit = splitEnabled && !!activeAgent;
  const toggleClasses = [
    styles.agentBarAddBtn,
    splitEnabled ? styles.active : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className={styles.agentBar}>
        <AgentTabBar
          activeAgentId={activeAgent?.agent_id ?? null}
          agents={agents}
          isHomeActive={isHomeActive}
          splitEnabled={splitEnabled}
          secondaryAgentId={secondaryAgentId}
          onClose={(agentId) => stopAgent(agentId)}
          onSelect={handleSelect}
          onSelectHome={() => setActiveAgent(workspaceId, null)}
        />
        <button
          className={styles.agentBarAddBtn}
          title="Start new agent"
          onClick={() => startNew()}
        >
          <Icons.PlusIcon size={12} />
        </button>
        <button
          className={toggleClasses}
          title={
            splitEnabled
              ? "Disable split view"
              : "Enable split view (⌥-click a tab to open it on the right)"
          }
          aria-pressed={splitEnabled}
          onClick={toggleSplit}
        >
          <Icons.SplitViewIcon size={14} />
        </button>
        <div className={styles.agentBarSpacer} />
      </div>

      {activeAgent ? (
        showSplit ? (
          <SplitAgentPanes
            agents={agents}
            primary={activeAgent}
            secondaryAgentId={secondaryAgentId}
            workspaceId={workspaceId}
            onRestart={(id) => restartAgent(id)}
          />
        ) : (
          <AgentChat
            agentId={activeAgent.agent_id}
            permissionMode={activeAgent.permission_mode}
            workspaceId={workspaceId}
            onRestart={() => restartAgent(activeAgent.agent_id)}
          />
        )
      ) : (
        <HomePanel workspaceId={workspaceId} />
      )}
    </>
  );
}
