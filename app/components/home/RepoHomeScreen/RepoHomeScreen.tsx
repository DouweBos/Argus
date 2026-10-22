import { useCallback, useMemo, useState } from "react";
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
import { useArgusVersionCheck } from "../../../hooks/useArgusVersionCheck";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { createHeadSession } from "../../../lib/ipc";
import { useAgentsRecord } from "../../../stores/agentStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { StartComposer } from "../../agent/StartComposer";
import { SetupConfigDialog } from "../../sidebar/SetupConfigDialog";
import { ActiveAgentsPanel } from "../ActiveAgentsPanel";
import { OpenInEditorButton } from "../OpenInEditor/OpenInEditorButton";
import { PathLink } from "../PathLink/PathLink";
import styles from "../homeLayout.module.css";
import { NoArgusJsonCard } from "./NoArgusJsonCard";
import { OutdatedArgusVersionCard } from "./OutdatedArgusVersionCard";

interface RepoHomeScreenProps {
  onResumeHistory: (sessionId: string) => void;
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
  onResumeHistory,
  onViewHistory,
}: RepoHomeScreenProps) {
  const agentsRecord = useAgentsRecord();
  const sessions = useSessions();
  const recent = useRecentProjects();
  const history = useChatHistory(repoRoot);
  const argusJson = useArgusJson(repoRoot);
  const versionCheck = useArgusVersionCheck(repoRoot);
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

  const handleOpenGit = useCallback(async () => {
    if (!repoRoot) {
      return;
    }
    try {
      const head = await createHeadSession(repoRoot);
      selectSession(head.id, "git");
    } catch {
      // Surfaced via the standard error toasts when ipc fails.
    }
  }, [repoRoot]);

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
            {repoRoot && (
              <Button
                variant="ghost"
                leading={<Icons.BranchIcon size={12} />}
                onClick={handleOpenGit}
                title="Open the project-root git client"
              >
                Git
              </Button>
            )}
          </div>
        </div>

        <StartComposer autoFocus sessionId={sessionId} />

        {repoRoot && argusJson.exists === false && (
          <NoArgusJsonCard
            repoRoot={repoRoot}
            onGenerated={handleArgusJsonGenerated}
          />
        )}

        {versionCheck.outdated && (
          <OutdatedArgusVersionCard
            appVersion={versionCheck.appVersion}
            minVersion={versionCheck.minVersion}
          />
        )}

        <SectionPanel title="Sessions" meta={`${visibleSessions.length} total`}>
          {visibleSessions.length === 0 ? (
            <div className={styles.emptyCell}>
              No sessions yet. Start an agent in a new worktree to make one.
            </div>
          ) : (
            <div className={styles.wsGrid}>
              {visibleSessions.map((ws) => {
                const wsAgents = repoAgents.filter(
                  (a) => a.session_id === ws.id,
                );
                const hasErr = wsAgents.some((a) => a.status === "error");
                const hasRun = wsAgents.some((a) => a.status === "running");

                return (
                  <SessionCard
                    key={ws.id}
                    icon={<Icons.BranchIcon size={13} />}
                    iconPulse={hasRun}
                    title={ws.display_name ?? ws.branch}
                    subtitle={ws.base_branch ?? undefined}
                    selected={ws.id === sessionId}
                    interactive
                    status={
                      hasErr ? { label: "error", tone: "error" } : undefined
                    }
                    onSelect={() => selectSession(ws.id)}
                  />
                );
              })}
            </div>
          )}
        </SectionPanel>

        <ActiveAgentsPanel repoRoot={repoRoot} />

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
