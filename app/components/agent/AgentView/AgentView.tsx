import { useMemo } from "react";
import { Icons } from "@argus/peacock";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { isWorkspaceReady } from "../../../lib/types";
import { setActiveAgent } from "../../../stores/agentStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { AgentChat } from "../AgentChat";
import { AgentTabBar } from "../AgentTabBar";
import { HomePanel } from "../HomePanel";
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

  return (
    <>
      <div className={styles.agentBar}>
        <AgentTabBar
          activeAgentId={activeAgent?.agent_id ?? null}
          agents={agents}
          isHomeActive={isHomeActive}
          onClose={(agentId) => stopAgent(agentId)}
          onSelect={(agentId) => setActive(agentId)}
          onSelectHome={() => setActiveAgent(workspaceId, null)}
        />
        <button
          className={styles.agentBarAddBtn}
          title="Start new agent"
          onClick={() => startNew()}
        >
          <Icons.PlusIcon size={12} />
        </button>
        <div className={styles.agentBarSpacer} />
      </div>

      {activeAgent ? (
        <AgentChat
          agentId={activeAgent.agent_id}
          permissionMode={activeAgent.permission_mode}
          workspaceId={workspaceId}
          onRestart={() => restartAgent(activeAgent.agent_id)}
        />
      ) : (
        <HomePanel workspaceId={workspaceId} />
      )}
    </>
  );
}
