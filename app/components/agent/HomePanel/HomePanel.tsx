import { useCallback, useMemo, useState } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { listChatHistory, loadChatHistory } from "../../../lib/ipc";
import { isWorkspaceReady } from "../../../lib/types";
import { setActiveAgent } from "../../../stores/agentStore";
import {
  clearConversation,
  loadSavedMessages,
} from "../../../stores/conversationStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { selectWorkspace, useWorkspaces } from "../../../stores/workspaceStore";
import { RepoHomeScreen } from "../../home/RepoHomeScreen";
import { AgentChat } from "../AgentChat";

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

  const historyAgentId = viewingHistoryId
    ? `history:${viewingHistoryId}`
    : null;

  const handleOrchestrationSelect = useCallback(
    (agentId: string, agentWorkspaceId: string) => {
      if (agentWorkspaceId !== workspaceId) {
        selectWorkspace(agentWorkspaceId);
      }
      setActiveAgent(agentWorkspaceId, agentId);
      setActiveCenterView("agents");
    },
    [workspaceId],
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
    <RepoHomeScreen
      canStart={wsReady}
      isStarting={isStarting}
      repoRoot={repoRoot}
      workspaceId={workspaceId}
      workspaceLabel={workspace?.branch ?? null}
      onResumeHistory={handleResumeHistory}
      onSelectAgent={handleOrchestrationSelect}
      onStart={() => {
        setActiveCenterView("agents");
        startNew();
      }}
      onViewHistory={handleViewHistory}
    />
  );
}
