import { useCallback, useMemo, useState } from "react";
import { useWorkspaceAgents } from "../../../hooks/useAgent";
import { listChatHistory, loadChatHistory } from "../../../lib/ipc";
import { isWorkspaceReady } from "../../../lib/types";
import { setActiveAgent } from "../../../stores/agentStore";
import {
  clearConversation,
  loadSavedMessages,
} from "../../../stores/conversationStore";
import {
  selectWorkspace,
  useWorkspaces,
} from "../../../stores/workspaceStore";
import {
  AgentStartIcon,
  HistoryIcon,
  OrchestrationIcon,
  PlusIcon,
} from "../../shared/Icons";
import { AgentChat } from "../AgentChat";
import { AgentTabBar } from "../AgentTabBar";
import { ChatHistoryList } from "../ChatHistoryList";
import { OrchestrationTree } from "../OrchestrationTree/OrchestrationTree";
import styles from "./AgentView.module.css";

interface AgentViewProps {
  workspaceId: string;
}

type Panel = "agent" | "history" | "orchestration";

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
  const [panel, setPanel] = useState<Panel>("agent");

  const handleOrchestrationSelect = useCallback(
    (agentId: string, agentWorkspaceId: string) => {
      if (agentWorkspaceId !== workspaceId) {
        selectWorkspace(agentWorkspaceId);
      }
      setActiveAgent(agentWorkspaceId, agentId);
      setPanel("agent");
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
          setPanel("agent");
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
      setPanel("agent");

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

  const togglePanel = (target: Panel) => {
    setPanel((p) => (p === target ? "agent" : target));
  };

  return (
    <>
      {/* Agent bar — always visible so the orchestration/history toggles
          are reachable even before any agent is running. */}
      <div className={styles.agentBar}>
        {hasAgents && (
          <AgentTabBar
            activeAgentId={
              panel === "agent" ? activeAgent?.agent_id ?? null : null
            }
            agents={agents}
            onClose={(agentId) => stopAgent(agentId)}
            onSelect={(agentId) => {
              setPanel("agent");
              setActive(agentId);
            }}
          />
        )}
        {hasAgents && (
          <button
            className={styles.agentBarAddBtn}
            title="Start new agent"
            onClick={() => {
              setPanel("agent");
              startNew();
            }}
          >
            <PlusIcon />
          </button>
        )}
        <div className={styles.agentBarSpacer} />
        <button
          className={`${styles.agentBarAddBtn} ${panel === "orchestration" ? styles.agentBarBtnActive : ""}`}
          title="Agent orchestration"
          onClick={() => togglePanel("orchestration")}
        >
          <OrchestrationIcon />
        </button>
        {repoRoot && (
          <button
            className={`${styles.agentBarAddBtn} ${panel === "history" ? styles.agentBarBtnActive : ""}`}
            title="Chat history"
            onClick={() => togglePanel("history")}
          >
            <HistoryIcon />
          </button>
        )}
      </div>

      {panel === "orchestration" && (
        <OrchestrationTree
          activeAgentId={activeAgent?.agent_id ?? null}
          title="Agents in workspace"
          workspaceFilter={workspaceId}
          onSelectAgent={handleOrchestrationSelect}
        />
      )}

      {panel === "history" && repoRoot && (
        <ChatHistoryList
          repoRoot={repoRoot}
          onResume={handleResumeHistory}
          onView={handleViewHistory}
        />
      )}

      {panel === "agent" && !activeAgent && (
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

      {panel === "agent" && activeAgent && (
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
