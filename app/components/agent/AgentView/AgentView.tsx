import { useCallback, useMemo, useState } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { listChatHistory, loadChatHistory } from "../../../lib/ipc";
import { isWorkspaceReady } from "../../../lib/types";
import { setActiveAgent } from "../../../stores/agentStore";
import {
  clearConversation,
  loadSavedMessages,
} from "../../../stores/conversationStore";
import { setAgentPanel, useAgentPanel } from "../../../stores/editorStore";
import { selectWorkspace, useWorkspaces } from "../../../stores/workspaceStore";
import { RepoHomeScreen } from "../../home/RepoHomeScreen";
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

  const repoRoot = workspace?.repo_root ?? null;

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

  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const panel = useAgentPanel();

  const handleOrchestrationSelect = useCallback(
    (agentId: string, agentWorkspaceId: string) => {
      if (agentWorkspaceId !== workspaceId) {
        selectWorkspace(agentWorkspaceId);
      }
      setActiveAgent(agentWorkspaceId, agentId);
      setAgentPanel("agent");
    },
    [workspaceId],
  );

  const historyAgentId = viewingHistoryId
    ? `history:${viewingHistoryId}`
    : null;

  const handleViewHistory = useCallback(
    (historyId: string) => {
      if (!repoRoot) {
        return;
      }
      loadChatHistory(repoRoot, historyId)
        .then((saved) => {
          if (!saved) {
            return;
          }
          const syntheticId = `history:${historyId}`;
          loadSavedMessages(
            syntheticId,
            saved.messages,
            saved.model,
            saved.sessionId,
          );
          setViewingHistoryId(historyId);
          setViewingSessionId(saved.sessionId);
          setAgentPanel("agent");
        })
        .catch(() => {});
    },
    [repoRoot],
  );

  const handleCloseHistory = useCallback(() => {
    if (historyAgentId) {
      clearConversation(historyAgentId);
    }
    setViewingHistoryId(null);
    setViewingSessionId(null);
  }, [historyAgentId]);

  const handleResumeHistory = useCallback(
    async (sessionId: string) => {
      handleCloseHistory();
      setAgentPanel("agent");

      const newAgentId = await startNew(undefined, undefined, sessionId);
      if (!newAgentId || !repoRoot) {
        return;
      }

      const entries = await listChatHistory(repoRoot).catch(() => []);
      const entry = entries.find((e) => e.sessionId === sessionId);
      if (entry) {
        const saved = await loadChatHistory(repoRoot, entry.id).catch(
          () => null,
        );
        if (saved && saved.messages.length > 0) {
          loadSavedMessages(
            newAgentId,
            saved.messages,
            saved.model,
            saved.sessionId,
            true,
          );
        }
      }
    },
    [handleCloseHistory, repoRoot, startNew],
  );

  if (viewingHistoryId && historyAgentId) {
    return (
      <AgentChat
        agentId={historyAgentId}
        readOnly
        workspaceId={workspaceId}
        onClose={handleCloseHistory}
        onResume={
          viewingSessionId
            ? () => handleResumeHistory(viewingSessionId)
            : undefined
        }
      />
    );
  }

  const wsReady = workspace != null && isWorkspaceReady(workspace.status);

  return (
    <>
      {hasAgents && (
        <div className={styles.agentBar}>
          <AgentTabBar
            activeAgentId={
              panel === "agent" ? (activeAgent?.agent_id ?? null) : null
            }
            agents={agents}
            onClose={(agentId) => stopAgent(agentId)}
            onSelect={(agentId) => {
              setAgentPanel("agent");
              setActive(agentId);
            }}
          />
          <button
            className={styles.agentBarAddBtn}
            title="Start new agent"
            onClick={() => {
              setAgentPanel("agent");
              startNew();
            }}
          >
            <PlusIcon />
          </button>
          <div className={styles.agentBarSpacer} />
        </div>
      )}

      {panel === "home" && (
        <RepoHomeScreen
          canStart={wsReady}
          isStarting={isStarting}
          repoRoot={repoRoot}
          workspaceId={workspaceId}
          workspaceLabel={workspace?.branch ?? null}
          onResumeHistory={handleResumeHistory}
          onSelectAgent={handleOrchestrationSelect}
          onStart={() => {
            setAgentPanel("agent");
            startNew();
          }}
          onViewHistory={handleViewHistory}
        />
      )}

      {panel === "agent" && activeAgent && (
        <AgentChat
          agentId={activeAgent.agent_id}
          permissionMode={activeAgent.permission_mode}
          workspaceId={workspaceId}
          onRestart={() => restartAgent(activeAgent.agent_id)}
        />
      )}

      {panel === "agent" && !activeAgent && (
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
