import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Button,
  IconBadge,
  Icons,
  projectAccent,
  SectionPanel,
  SessionCard,
} from "@argus/peacock";
import { useArgusJson } from "../../../hooks/useArgusJson";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { useAgentsRecord } from "../../../stores/agentStore";
import {
  showCreateSessionDialog,
  triggerNewSession,
} from "../../../stores/dialogStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { SetupConfigDialog } from "../../sidebar/SetupConfigDialog";
import { OpenInEditorButton } from "../OpenInEditor/OpenInEditorButton";
import { PathLink } from "../PathLink/PathLink";
import styles from "../homeLayout.module.css";
import { NoArgusJsonCard } from "./NoArgusJsonCard";

interface RepoHomeScreenProps {
  canStart: boolean;
  isStarting: boolean;
  onResumeHistory: (sessionId: string) => void;
  onStart: () => void;
  onStartPlan: () => void;
  onViewHistory: (historyId: string) => void;
  repoRoot: string | null;
  sessionId: string;
}

function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export function RepoHomeScreen({
  sessionId,
  repoRoot,
  isStarting,
  canStart,
  onStart,
  onStartPlan,
  onResumeHistory,
  onViewHistory,
}: RepoHomeScreenProps) {
  const agentsRecord = useAgentsRecord();
  const sessions = useSessions();
  const recent = useRecentProjects();
  const history = useChatHistory(repoRoot);
  const argusJson = useArgusJson(repoRoot);
  const handleArgusJsonGenerated = argusJson.refresh;
  const [showProjectSettings, setShowProjectSettings] = useState(false);

  const repoSessions = useMemo(
    () => (repoRoot ? sessions.filter((w) => w.repo_root === repoRoot) : []),
    [sessions, repoRoot],
  );

  const visibleSessions = useMemo(
    () => repoSessions.filter((w) => w.kind !== "project_root"),
    [repoSessions],
  );

  const repoSessionIds = useMemo(
    () => new Set(repoSessions.map((w) => w.id)),
    [repoSessions],
  );

  const repoAgents = useMemo(
    () =>
      Object.values(agentsRecord).filter((a) =>
        repoSessionIds.has(a.session_id),
      ),
    [agentsRecord, repoSessionIds],
  );

  const projectName = useMemo(() => {
    if (!repoRoot) {
      return "Session";
    }
    const rp = recent.find((r) => r.path === repoRoot);

    return rp?.name ?? basename(repoRoot);
  }, [recent, repoRoot]);

  const accent = useMemo(
    () => (repoRoot ? projectAccent(repoRoot) : "var(--accent)"),
    [repoRoot],
  );

  const handleNewSession = () => {
    if (repoRoot) {
      showCreateSessionDialog(repoRoot);
    } else {
      triggerNewSession();
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <div
            className={styles.brandMark}
            style={{ ["--project-accent" as string]: accent }}
          >
            <IconBadge size="lg" tone="project">
              <Icons.FolderIcon size={18} />
            </IconBadge>
            <div className={styles.titleStack}>
              <h1 className={styles.title}>{projectName}</h1>
              {repoRoot && (
                <PathLink path={repoRoot} style={{ marginTop: 0 }} />
              )}
            </div>
          </div>
          <div className={styles.heroSpacer} />
          <div className={styles.ctas}>
            {repoRoot && <OpenInEditorButton path={repoRoot} />}
            {repoRoot && argusJson.exists !== false && (
              <Button
                variant="ghost"
                leading={<Icons.GearIcon size={12} />}
                onClick={() => setShowProjectSettings(true)}
                title="Edit .argus.json — copy/symlink rules, run commands, ports"
              >
                Project settings
              </Button>
            )}
            <Button
              variant="ghost"
              leading={<Icons.PlusIcon size={12} />}
              onClick={handleNewSession}
            >
              New session
            </Button>
            <Button
              variant="ghost"
              leading={<Icons.AgentStartIcon size={12} />}
              disabled={!canStart || isStarting}
              onClick={onStartPlan}
              title="Start in plan mode — agent must present a plan for approval before any writes"
            >
              Plan mode
            </Button>
            <Button
              variant="primary"
              leading={<Icons.AgentStartIcon size={12} />}
              disabled={!canStart || isStarting}
              onClick={onStart}
            >
              {isStarting ? "Starting…" : "Start agent"}
            </Button>
          </div>
        </div>

        {repoRoot && argusJson.exists === false && (
          <NoArgusJsonCard
            repoRoot={repoRoot}
            onGenerated={handleArgusJsonGenerated}
          />
        )}

        <SectionPanel
          title="Sessions"
          meta={`${visibleSessions.length} total`}
          action={
            <button
              type="button"
              className={styles.linkBtn}
              onClick={handleNewSession}
            >
              New
            </button>
          }
        >
          {visibleSessions.length === 0 ? (
            <div className={styles.emptyCell}>
              No sessions yet. Create one to start a branch.
            </div>
          ) : (
            <div className={styles.wsGrid}>
              {visibleSessions.map((ws) => {
                const wsAgents = repoAgents.filter(
                  (a) => a.session_id === ws.id,
                );
                const hasErr = wsAgents.some((a) => a.status === "error");
                const hasRun = wsAgents.some((a) => a.status === "running");
                let statusTone: "error" | "idle" | "success" = "idle";
                if (hasErr) {
                  statusTone = "error";
                } else if (hasRun) {
                  statusTone = "success";
                }

                return (
                  <SessionCard
                    key={ws.id}
                    branch={ws.display_name ?? ws.branch}
                    parentBranch={ws.base_branch ?? undefined}
                    selected={ws.id === sessionId}
                    status={statusTone}
                    pulse={hasRun}
                    role="button"
                    tabIndex={0}
                    style={{ cursor: "pointer" }}
                    onClick={() => selectSession(ws.id)}
                  />
                );
              })}
            </div>
          )}
        </SectionPanel>

        {repoRoot && history.loaded && history.entries.length > 0 && (
          <ChatHistoryList
            entries={history.entries}
            title="Chat history"
            meta={`${history.entries.length} sessions`}
            repoRoot={repoRoot}
            onClearAll={() => history.clearAll()}
            onDelete={(historyId) => history.remove(historyId)}
            onResume={onResumeHistory}
            onView={onViewHistory}
          />
        )}
      </div>

      {showProjectSettings &&
        repoRoot &&
        createPortal(
          <SetupConfigDialog
            repoRoot={repoRoot}
            onClose={() => setShowProjectSettings(false)}
            onSaved={() => argusJson.refresh()}
          />,
          document.body,
        )}
    </div>
  );
}
