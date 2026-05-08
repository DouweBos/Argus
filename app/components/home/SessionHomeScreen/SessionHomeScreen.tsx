import { useMemo, useState } from "react";
import {
  Button,
  CalloutCard,
  IconBadge,
  Icons,
  projectAccent,
} from "@argus/peacock";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { clearSessionSetupError, retrySessionSetup } from "../../../lib/ipc";
import { useOrgTaskForSession } from "../../../stores/orgTaskStore";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { setPendingPrompt, useSessions } from "../../../stores/sessionStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { TaskWidgets } from "../../organizations/TaskWidgets";
import { ChangeBaseBranchDialog } from "../ChangeBaseBranchDialog";
import { OpenInEditorButton } from "../OpenInEditor/OpenInEditorButton";
import { PathLink } from "../PathLink/PathLink";
import { RenameBranchDialog } from "../RenameBranchDialog/RenameBranchDialog";
import { ReadyToMergeCard } from "../RepoHomeScreen/ReadyToMergeCard";
import styles from "../homeLayout.module.css";
import { InitializationStatus } from "./InitializationStatus";

interface SessionHomeScreenProps {
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

export function SessionHomeScreen({
  sessionId,
  repoRoot,
  isStarting,
  canStart,
  onStart,
  onStartPlan,
  onViewHistory,
  onResumeHistory,
}: SessionHomeScreenProps) {
  const sessions = useSessions();
  const recent = useRecentProjects();
  const history = useChatHistory(repoRoot);
  const orgTask = useOrgTaskForSession(sessionId);

  const session = useMemo(
    () => sessions.find((w) => w.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const sessionHistoryEntries = useMemo(
    () =>
      session
        ? history.entries.filter((e) => e.sessionBranch === session.branch)
        : [],
    [history.entries, session],
  );

  const [isRenamingBranch, setIsRenamingBranch] = useState(false);
  const [isChangingBaseBranch, setIsChangingBaseBranch] = useState(false);
  const [isClearingSetupError, setIsClearingSetupError] = useState(false);
  const [isRetryingSetup, setIsRetryingSetup] = useState(false);

  const setupError =
    session && typeof session.status === "object" && "error" in session.status
      ? session.status.error
      : null;

  const projectName = useMemo(() => {
    if (!repoRoot) {
      return "";
    }
    const rp = recent.find((r) => r.path === repoRoot);

    return rp?.name ?? basename(repoRoot);
  }, [recent, repoRoot]);

  const accent = useMemo(
    () => (repoRoot ? projectAccent(repoRoot) : "var(--accent)"),
    [repoRoot],
  );

  const displayName = session?.display_name ?? session?.branch ?? "Session";
  const branch = session?.branch ?? "";
  const baseBranch = session?.base_branch ?? null;

  return (
    <div className={styles.screen}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <div
            className={styles.brandMark}
            style={{ ["--project-accent" as string]: accent }}
          >
            <IconBadge size="lg" tone="project">
              <Icons.BranchIcon size={18} />
            </IconBadge>
            <div>
              <h1 className={styles.title}>{displayName}</h1>
              <div className={styles.sub}>
                <span className={styles.branchChip}>
                  <Icons.BranchIcon size={10} />
                  {branch}
                  {session?.kind === "worktree" && (
                    <button
                      type="button"
                      className={styles.branchEditBtn}
                      onClick={() => setIsRenamingBranch(true)}
                      title="Rename branch"
                      aria-label="Rename branch"
                    >
                      <Icons.PencilIcon size={10} />
                    </button>
                  )}
                </span>
                {(baseBranch || session?.kind === "worktree") && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span className={styles.branchChip}>
                      <Icons.BranchIcon size={10} />
                      from {baseBranch ?? "—"}
                      {session?.kind === "worktree" && (
                        <button
                          type="button"
                          className={styles.branchEditBtn}
                          onClick={() => setIsChangingBaseBranch(true)}
                          title="Change source branch"
                          aria-label="Change source branch"
                        >
                          <Icons.PencilIcon size={10} />
                        </button>
                      )}
                    </span>
                  </>
                )}
                {projectName && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span>in {projectName}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className={styles.heroSpacer} />
          <div className={styles.ctas}>
            {session?.path && <OpenInEditorButton path={session.path} />}
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

        {session?.path && <PathLink path={session.path} />}

        {session?.status === "initializing" && (
          <InitializationStatus sessionId={sessionId} />
        )}

        {setupError && (
          <CalloutCard
            tone="error"
            leading={<Icons.WarningIcon size={16} />}
            title="Setup failed"
            meta={setupError}
            actions={
              <>
                <Button
                  variant="ghost"
                  disabled={isRetryingSetup || isClearingSetupError}
                  onClick={async () => {
                    setIsRetryingSetup(true);
                    try {
                      await retrySessionSetup(sessionId);
                    } finally {
                      setIsRetryingSetup(false);
                    }
                  }}
                  title="Re-run the setup commands for this session."
                >
                  {isRetryingSetup ? "Retrying…" : "Retry"}
                </Button>
                <Button
                  variant="ghost"
                  disabled={isClearingSetupError || isRetryingSetup}
                  onClick={async () => {
                    setIsClearingSetupError(true);
                    try {
                      const initialPrompt = session?.description.trim();
                      if (initialPrompt) {
                        setPendingPrompt(sessionId, initialPrompt);
                      }
                      await clearSessionSetupError(sessionId);
                    } finally {
                      setIsClearingSetupError(false);
                    }
                  }}
                  title="Mark setup as complete and unblock this session. Use this after you've fixed the failing step yourself in a terminal."
                >
                  {isClearingSetupError ? "Clearing…" : "Mark as ready"}
                </Button>
              </>
            }
          />
        )}

        {orgTask && <TaskWidgets task={orgTask} />}

        <ReadyToMergeCard
          baseBranch={session?.base_branch}
          description={session?.description}
          repoRoot={session?.repo_root}
          sessionBranch={session?.branch}
          sessionId={sessionId}
        />

        {repoRoot && history.loaded && sessionHistoryEntries.length > 0 && (
          <ChatHistoryList
            entries={sessionHistoryEntries}
            title="Chat history"
            meta={`${sessionHistoryEntries.length} in this session`}
            repoRoot={repoRoot}
            onClearAll={() => history.clearAll()}
            onDelete={(historyId) => history.remove(historyId)}
            onResume={onResumeHistory}
            onView={onViewHistory}
          />
        )}
      </div>
      {isRenamingBranch && session && (
        <RenameBranchDialog
          session={session}
          onClose={() => setIsRenamingBranch(false)}
        />
      )}
      {isChangingBaseBranch && session && (
        <ChangeBaseBranchDialog
          session={session}
          onClose={() => setIsChangingBaseBranch(false)}
        />
      )}
    </div>
  );
}
