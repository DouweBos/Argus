import { useCallback, useMemo, useState } from "react";
import { Dialog, DialogBody } from "@argus/peacock";
import { useSessionAgents } from "../../../hooks/useAgent";
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
import { StartAgentDialog } from "../StartAgentDialog";

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

      // Read the saved record first: the new agent has to resume on the
      // runner that wrote the transcript, not the session's default.
      const entries = repoRoot
        ? await listChatHistory(repoRoot).catch(() => [])
        : [];
      const entry = entries.find((e) => e.sessionId === claudeSessionId);

      // The host seeds the resumed agent's conversation from this record.
      await startNew(undefined, undefined, claudeSessionId, entry?.runnerId);
    },
    [handleCloseHistory, repoRoot, startNew],
  );

  const isRepoHome = session?.kind === "project_root";

  const [startDialogMode, setStartDialogMode] = useState<
    "auto" | "plan" | null
  >(null);

  const handleStart = () => {
    setStartDialogMode("auto");
  };

  const handleStartPlan = () => {
    setStartDialogMode("plan");
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
      {startDialogMode && (
        <StartAgentDialog
          initialMode={startDialogMode}
          sessionId={sessionId}
          onClose={() => setStartDialogMode(null)}
        />
      )}
      {viewingHistoryId && historyAgentId && (
        <Dialog
          size="full"
          title={viewingTitle}
          titleId="chat-history-preview-title"
          onClose={handleCloseHistory}
        >
          <DialogBody flush>
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
          </DialogBody>
        </Dialog>
      )}
    </>
  );
}
