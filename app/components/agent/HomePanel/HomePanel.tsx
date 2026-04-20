import { Dialog } from "@argus/peacock";
import { useCallback, useMemo, useState } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { focusAgent } from "../../../lib/agentLifecycle";
import { listChatHistory, loadChatHistory } from "../../../lib/ipc";
import { isWorkspaceReady } from "../../../lib/types";
import {
  clearConversation,
  loadSavedMessages,
} from "../../../stores/conversationStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { RepoHomeScreen } from "../../home/RepoHomeScreen";
import { WorkspaceHomeScreen } from "../../home/WorkspaceHomeScreen";
import { AgentChat } from "../AgentChat";
import styles from "./HomePanel.module.css";

interface HomePanelProps {
  workspaceId: string;
}

export function HomePanel({ workspaceId }: HomePanelProps) {
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.find((w) => w.id === workspaceId) ?? null,
    [workspaces, workspaceId],
  );

  const repoRoot = workspace?.repo_root ?? null;

  const { startNew, isStarting } = useWorkspaceAgents(workspaceId, {
    autoStart: false,
    workspaceReady: workspace ? isWorkspaceReady(workspace.status) : false,
  });

  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [viewingTitle, setViewingTitle] = useState<string>("Chat preview");

  const historyAgentId = viewingHistoryId
    ? `history:${viewingHistoryId}`
    : null;

  const handleOrchestrationSelect = useCallback(
    (agentId: string, agentWorkspaceId: string) => {
      focusAgent(agentWorkspaceId, agentId);
    },
    [],
  );

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
          setViewingTitle(saved.title || "Chat preview");
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
      setActiveCenterView("agents");

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
            saved.title,
          );
        }
      }
    },
    [handleCloseHistory, repoRoot, startNew],
  );

  const wsReady = workspace != null && isWorkspaceReady(workspace.status);
  const isRepoHome = workspace?.kind === "repo_root";

  const handleStart = () => {
    setActiveCenterView("agents");
    startNew();
  };

  const handleStartPlan = () => {
    setActiveCenterView("agents");
    startNew(undefined, "plan");
  };

  return (
    <>
      {isRepoHome ? (
        <RepoHomeScreen
          canStart={wsReady}
          isStarting={isStarting}
          repoRoot={repoRoot}
          workspaceId={workspaceId}
          onResumeHistory={handleResumeHistory}
          onSelectAgent={handleOrchestrationSelect}
          onStart={handleStart}
          onStartPlan={handleStartPlan}
          onViewHistory={handleViewHistory}
        />
      ) : (
        <WorkspaceHomeScreen
          canStart={wsReady}
          isStarting={isStarting}
          repoRoot={repoRoot}
          workspaceId={workspaceId}
          onResumeHistory={handleResumeHistory}
          onSelectAgent={handleOrchestrationSelect}
          onStart={handleStart}
          onStartPlan={handleStartPlan}
          onViewHistory={handleViewHistory}
        />
      )}
      {viewingHistoryId && historyAgentId && (
        <Dialog
          className={styles.dialog}
          title={viewingTitle}
          titleId="chat-history-preview-title"
          onClose={handleCloseHistory}
        >
          <div className={styles.body}>
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
          </div>
        </Dialog>
      )}
    </>
  );
}
