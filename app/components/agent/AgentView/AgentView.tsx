import { useCallback, useMemo, useState } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { listChatHistory, loadChatHistory } from "../../../lib/ipc";
import { isWorkspaceReady } from "../../../lib/types";
import {
  clearConversation,
  loadSavedMessages,
} from "../../../stores/conversationStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { AgentStartIcon, HistoryIcon, PlusIcon } from "../../shared/Icons";
import { AgentChat } from "../AgentChat";
import { AgentTabBar } from "../AgentTabBar";
import { ChatHistoryList } from "../ChatHistoryList";
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

  // History viewing state
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);

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
          setShowHistoryPanel(false);
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
      setShowHistoryPanel(false);

      // Start the new agent with --resume
      const newAgentId = await startNew(undefined, undefined, sessionId);
      if (!newAgentId || !repoRoot) {
        return;
      }

      // Load the saved conversation's messages into the new agent's conversation
      // store so they're visible immediately. Set resuming=true so replayed
      // events from --resume are skipped until the first result.
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
            true, // resuming — skip replayed events
          );
        }
      }
    },
    [handleCloseHistory, repoRoot, startNew],
  );

  // If viewing history, show the read-only chat (no agent bar)
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
      {/* Agent bar — only shown when agents are running */}
      {hasAgents && (
        <div className={styles.agentBar}>
          <AgentTabBar
            activeAgentId={activeAgent?.agent_id ?? null}
            agents={agents}
            onClose={(agentId) => stopAgent(agentId)}
            onSelect={setActive}
          />
          <button
            className={styles.agentBarAddBtn}
            title="Start new agent"
            onClick={() => startNew()}
          >
            <PlusIcon />
          </button>
          {repoRoot && (
            <button
              className={`${styles.agentBarAddBtn} ${showHistoryPanel ? styles.agentBarBtnActive : ""}`}
              title="Chat history"
              onClick={() => setShowHistoryPanel((p) => !p)}
            >
              <HistoryIcon />
            </button>
          )}
        </div>
      )}

      {/* History panel overlay when toggled from agent bar */}
      {showHistoryPanel && repoRoot && (
        <ChatHistoryList
          repoRoot={repoRoot}
          onResume={handleResumeHistory}
          onView={handleViewHistory}
        />
      )}

      {/* Empty state — no agents running */}
      {!showHistoryPanel && !activeAgent && (
        <div className={styles.noAgentContent}>
          <div className={styles.emptyState}>
            <button
              className={styles.startAgentBtn}
              disabled={!wsReady || isStarting}
              onClick={() => startNew()}
            >
              <AgentStartIcon />
              {isStarting ? "Starting…" : "Start Agent"}
            </button>
            <p className={styles.hintText}>
              {wsReady
                ? "Launch a Claude Code agent in this workspace."
                : "Workspace is being prepared…"}
            </p>
          </div>
          {repoRoot && (
            <ChatHistoryList
              repoRoot={repoRoot}
              onResume={handleResumeHistory}
              onView={handleViewHistory}
            />
          )}
        </div>
      )}

      {/* Active agent chat */}
      {!showHistoryPanel && activeAgent && (
        <AgentChat
          agentId={activeAgent.agent_id}
          permissionMode={activeAgent.permission_mode}
          workspaceId={workspaceId}
          onRestart={() => restartAgent(activeAgent.agent_id)}
        />
      )}
    </>
  );
}
