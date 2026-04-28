import { useCallback, useMemo, useState } from "react";
import { Dialog } from "@argus/peacock";
import { useSessionAgents } from "../../../hooks/useAgent";
import { focusAgent } from "../../../lib/agentLifecycle";
import { listChatHistory, loadChatHistory } from "../../../lib/ipc";
import { isSessionReady } from "../../../lib/types";
import {
  clearConversation,
  loadSavedMessages,
} from "../../../stores/conversationStore";
import { setActiveCenterView } from "../../../stores/editorStore";
import { useSessions } from "../../../stores/sessionStore";
import { RepoHomeScreen } from "../../home/RepoHomeScreen";
import { SessionHomeScreen } from "../../home/SessionHomeScreen";
import { AgentChat } from "../AgentChat";
import styles from "./HomePanel.module.css";

interface HomePanelProps {
  sessionId: string;
}

export function HomePanel({ sessionId }: HomePanelProps) {
  const sessions = useSessions();
  const session = useMemo(
    () => sessions.find((w) => w.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const repoRoot = session?.repo_root ?? null;

  const { startNew, isStarting } = useSessionAgents(sessionId, {
    autoStart: false,
    sessionReady: session ? isSessionReady(session.status) : false,
  });

  // The session's worktree exists as soon as `createSession` resolves, so
  // agents can be spawned while the setup pipeline (copy/symlink/install)
  // is still running in the background. Only block the start buttons when
  // the session is in a terminal bad state.
  const canStart = useMemo(() => {
    if (!session) {
      return false;
    }
    if (typeof session.status === "object") {
      return false;
    }

    return session.status !== "deleting";
  }, [session]);

  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [viewingTitle, setViewingTitle] = useState<string>("Chat preview");

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
    async (claudeSessionId: string) => {
      handleCloseHistory();
      setActiveCenterView("agents");

      const newAgentId = await startNew(undefined, undefined, claudeSessionId);
      if (!newAgentId || !repoRoot) {
        return;
      }
      // Resuming from chat history is an explicit user action — surface the
      // resumed agent as active so the chat panel actually shows it. (New
      // agents otherwise don't auto-focus; see commit 41cf172d.)
      focusAgent(sessionId, newAgentId);

      const entries = await listChatHistory(repoRoot).catch(() => []);
      const entry = entries.find((e) => e.sessionId === claudeSessionId);
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
    [handleCloseHistory, repoRoot, sessionId, startNew],
  );

  const isRepoHome = session?.kind === "project_root";

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
          canStart={canStart}
          isStarting={isStarting}
          repoRoot={repoRoot}
          sessionId={sessionId}
          onResumeHistory={handleResumeHistory}
          onStart={handleStart}
          onStartPlan={handleStartPlan}
          onViewHistory={handleViewHistory}
        />
      ) : (
        <SessionHomeScreen
          canStart={canStart}
          isStarting={isStarting}
          repoRoot={repoRoot}
          sessionId={sessionId}
          onResumeHistory={handleResumeHistory}
          onStart={handleStart}
          onStartPlan={handleStartPlan}
          onViewHistory={handleViewHistory}
        />
      )}
      {viewingHistoryId && historyAgentId && (
        <Dialog
          size="full"
          title={viewingTitle}
          titleId="chat-history-preview-title"
          onClose={handleCloseHistory}
        >
          <div className={styles.body}>
            <AgentChat
              agentId={historyAgentId}
              readOnly
              sessionId={sessionId}
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
