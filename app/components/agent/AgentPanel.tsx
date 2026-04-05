import { useState } from "react";
import { useWorkspaceAgents } from "../../hooks/useAgent";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { isWorkspaceReady } from "../../lib/types";
import { AgentChat } from "./AgentChat";
import { AgentTabBar } from "./AgentTabBar";
import { MergeBar } from "../runtime/MergeBar";
import { EditorPanel } from "../editor/EditorPanel";
import { StagehandLogo, AgentStartIcon, PlusIcon } from "../shared/Icons";
import styles from "./AgentPanel.module.css";

type ActiveView = "agents" | "editor";

interface AgentPanelProps {
  workspaceId: null | string;
}

export function AgentPanel({ workspaceId }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    workspaceId
      ? (s.workspaces.find((w) => w.id === workspaceId) ?? null)
      : null,
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

  // View switcher state
  const [activeView, setActiveView] = useState<ActiveView>("agents");

  if (!workspaceId || !workspace) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyContent}>
          <StagehandLogo className={styles.logo} />
          <h2 className={styles.emptyTitle}>Stagehand</h2>
          <p className={styles.emptySubtitle}>
            Select or create a workspace to begin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      {/* View switcher */}
      <div className={styles.navRow}>
        <div className={styles.viewSwitcher}>
          <button
            className={`${styles.viewTab} ${activeView === "agents" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("agents")}
          >
            Agents
          </button>
          <button
            className={`${styles.viewTab} ${activeView === "editor" ? styles.viewTabActive : ""}`}
            onClick={() => setActiveView("editor")}
          >
            Editor
          </button>
        </div>
      </div>

      {/* Content area */}
      {activeView === "editor" && <EditorPanel workspaceId={workspaceId} />}

      {activeView === "agents" && (
        <>
          {/* Secondary agent bar */}
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
                disabled={!isWorkspaceReady(workspace.status) || isStarting}
                data-starting={isStarting}
              >
                <AgentStartIcon />
                {isStarting ? "Starting…" : "Start Agent"}
              </button>
            )}
          </div>

          {/* Agent content */}
          {activeAgent?.status === "error" && (
            <div className={styles.noSession}>
              <p className={styles.errorText}>
                Agent encountered an error. Try starting it again.
              </p>
            </div>
          )}
          {!activeAgent && !isStarting && (
            <div className={styles.noSession}>
              <p className={styles.hintText}>
                {isWorkspaceReady(workspace.status)
                  ? "Press Start Agent to launch Claude Code in this workspace."
                  : "Workspace is being prepared\u2026"}
              </p>
            </div>
          )}
          {!activeAgent && isStarting && (
            <div className={styles.noSession}>
              <p className={styles.hintText}>Starting agent…</p>
            </div>
          )}
          {activeAgent && activeAgent.status !== "error" && (
            <AgentChat
              agentId={activeAgent.agent_id}
              workspaceId={workspaceId}
              permissionMode={activeAgent.permission_mode}
              onRestartWithModel={async (model) => {
                await restartAgent(activeAgent.agent_id, { model });
              }}
              onTogglePlanMode={async () => {
                const currentMode = activeAgent.permission_mode;
                const newMode = currentMode === "plan" ? undefined : "plan";
                await restartAgent(activeAgent.agent_id, {
                  permissionMode: newMode,
                });
              }}
            />
          )}
        </>
      )}

      {/* Merge bar at bottom, always visible for worktree workspaces */}
      <MergeBar workspaceId={workspaceId} />
    </div>
  );
}
