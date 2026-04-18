import { useMemo } from "react";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useWorkspaces } from "../../../stores/workspaceStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { OrchestrationTree } from "../../agent/OrchestrationTree/OrchestrationTree";
import { AgentStartIcon } from "../../shared/Icons";
import styles from "./RepoHomeScreen.module.css";

interface RepoHomeScreenProps {
  canStart: boolean;
  isStarting: boolean;
  onResumeHistory: (sessionId: string) => void;
  onSelectAgent: (agentId: string, workspaceId: string) => void;
  onStart: () => void;
  onViewHistory: (historyId: string) => void;
  /** Repo root path — used to scope orchestration and chat history. */
  repoRoot: string | null;
  /** Current workspace ID (drives orchestration filter). */
  workspaceId: string;
  /** Short workspace branch/name shown in the header subtitle. */
  workspaceLabel?: string | null;
}

export function RepoHomeScreen({
  workspaceId,
  repoRoot,
  workspaceLabel,
  isStarting,
  canStart,
  onStart,
  onSelectAgent,
  onViewHistory,
  onResumeHistory,
}: RepoHomeScreenProps) {
  const agents = useAgentsRecord();
  const workspaces = useWorkspaces();
  const history = useChatHistory(repoRoot);

  // Does this repo have any agents across all its workspaces?
  const repoHasAgents = useMemo(() => {
    if (!repoRoot) {
      return false;
    }
    const repoWorkspaceIds = new Set(
      workspaces.filter((w) => w.repo_root === repoRoot).map((w) => w.id),
    );

    return Object.values(agents).some((a) =>
      repoWorkspaceIds.has(a.workspace_id),
    );
  }, [agents, workspaces, repoRoot]);

  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <div className={styles.header}>
          <h1 className={styles.title}>{workspaceLabel ?? "Workspace"}</h1>
          {repoRoot && <p className={styles.subtitle}>{repoRoot}</p>}
        </div>

        <div className={styles.actions}>
          <button
            className={styles.startAgentBtn}
            disabled={!canStart || isStarting}
            onClick={onStart}
          >
            <AgentStartIcon />
            {isStarting ? "Starting\u2026" : "Start Agent"}
          </button>
        </div>

        {repoHasAgents && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Agents</h2>
            <div className={styles.treeWrap}>
              <OrchestrationTree
                activeAgentId={null}
                title="Agents in workspace"
                workspaceFilter={workspaceId}
                onSelectAgent={onSelectAgent}
              />
            </div>
          </div>
        )}

        {repoRoot && history.loaded && history.entries.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Chat History</h2>
            <div className={styles.historyWrap}>
              <ChatHistoryList
                entries={history.entries}
                onClearAll={history.clearAll}
                onDelete={history.remove}
                onResume={onResumeHistory}
                onView={onViewHistory}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
