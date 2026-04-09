import { useWorkspaceAgents } from "../../hooks/useAgent";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { isWorkspaceReady } from "../../lib/types";
import { AgentChat } from "./AgentChat";
import { AgentTabBar } from "./AgentTabBar";
import { AgentStartIcon, PlusIcon } from "../shared/Icons";
import styles from "./AgentView.module.css";

interface AgentViewProps {
  workspaceId: string;
}

export function AgentView({ workspaceId }: AgentViewProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === workspaceId) ?? null,
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
    autoStart: true,
    workspaceReady: workspace ? isWorkspaceReady(workspace.status) : false,
  });

  return (
    <>
      {/* Agent bar */}
      <div className={styles.agentBar}>
        {hasAgents ? (
          <>
            <AgentTabBar
              agents={agents}
              activeAgentId={activeAgent?.agent_id ?? null}
              onSelect={setActive}
              onClose={(agentId) => stopAgent(agentId)}
            />
            <button
              className={styles.agentBarAddBtn}
              onClick={() => startNew()}
              title="Start new agent"
            >
              <PlusIcon />
            </button>
          </>
        ) : (
          <button
            className={styles.agentBarStartBtn}
            onClick={() => startNew()}
            disabled={!workspace || !isWorkspaceReady(workspace.status) || isStarting}
            data-starting={isStarting}
          >
            <AgentStartIcon />
            {isStarting ? "Starting…" : "Start Agent"}
          </button>
        )}
      </div>

      {/* Agent content */}
      {!activeAgent && !isStarting && (
        <div className={styles.noSession}>
          <p className={styles.hintText}>
            {workspace && isWorkspaceReady(workspace.status)
              ? "Press Start Agent to launch Claude Code in this workspace."
              : "Workspace is being prepared…"}
          </p>
        </div>
      )}
      {!activeAgent && isStarting && (
        <div className={styles.noSession}>
          <p className={styles.hintText}>Starting agent…</p>
        </div>
      )}
      {activeAgent && (
        <AgentChat
          agentId={activeAgent.agent_id}
          workspaceId={workspaceId}
          permissionMode={activeAgent.permission_mode}
          onRestart={() => restartAgent(activeAgent.agent_id)}
        />
      )}
    </>
  );
}
