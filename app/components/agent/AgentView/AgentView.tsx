import { useMemo } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { isWorkspaceReady } from "../../../lib/types";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { AgentStartIcon, PlusIcon } from "../../shared/Icons";
import { AgentChat } from "../AgentChat";
import { AgentTabBar } from "../AgentTabBar";
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

  const {
    agents,
    activeAgent,
    startNew,
    stopAgent,
    restartAgent,
    setActive,
    hasAgents,
    isStarting,
  } = useWorkspaceAgents(workspaceId, {
    autoStart: false,
    workspaceReady: workspace ? isWorkspaceReady(workspace.status) : false,
  });

  const wsReady = workspace != null && isWorkspaceReady(workspace.status);

  return (
    <>
      {hasAgents && (
        <div className={styles.agentBar}>
          <AgentTabBar
            activeAgentId={activeAgent?.agent_id ?? null}
            agents={agents}
            onClose={(agentId) => stopAgent(agentId)}
            onSelect={(agentId) => setActive(agentId)}
          />
          <button
            className={styles.agentBarAddBtn}
            title="Start new agent"
            onClick={() => startNew()}
          >
            <PlusIcon />
          </button>
          <div className={styles.agentBarSpacer} />
        </div>
      )}

      {activeAgent && (
        <AgentChat
          agentId={activeAgent.agent_id}
          permissionMode={activeAgent.permission_mode}
          workspaceId={workspaceId}
          onRestart={() => restartAgent(activeAgent.agent_id)}
        />
      )}

      {!activeAgent && (
        <div className={styles.agentEmpty}>
          <div className={styles.agentEmptyCard}>
            <div className={styles.agentEmptyDot} />
            <h2 className={styles.agentEmptyTitle}>No agent running</h2>
            <p className={styles.agentEmptyHint}>
              Spin up a Claude Code agent to work on{" "}
              <span className={styles.agentEmptyBranch}>
                {workspace?.branch ?? "this workspace"}
              </span>
              .
            </p>
            <button
              className={styles.agentEmptyStartBtn}
              disabled={!wsReady || isStarting}
              onClick={() => startNew()}
            >
              <AgentStartIcon />
              {isStarting ? "Starting\u2026" : "Start Agent"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
