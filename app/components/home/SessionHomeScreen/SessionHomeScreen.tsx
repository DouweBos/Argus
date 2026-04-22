import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DiffStat,
  IconBadge,
  Icons,
  projectAccent,
  SectionPanel,
} from "@argus/peacock";
import { useChatHistory } from "../../../hooks/useChatHistory";
import { listen } from "../../../lib/events";
import { watchSession } from "../../../lib/ipc";
import { useRecentProjects } from "../../../stores/recentProjectsStore";
import { useSessions } from "../../../stores/sessionStore";
import { ChatHistoryList } from "../../agent/ChatHistoryList";
import { OpenInEditorButton } from "../OpenInEditor/OpenInEditorButton";
import { PathLink } from "../PathLink/PathLink";
import { RenameBranchDialog } from "../RenameBranchDialog/RenameBranchDialog";
import { ReadyToMergeCard } from "../RepoHomeScreen/ReadyToMergeCard";
import styles from "../homeLayout.module.css";

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

interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
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

  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const [isRenamingBranch, setIsRenamingBranch] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<DiffStats>(
      `session:diff-changed:${sessionId}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );
    watchSession(sessionId).catch(() => {});

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [sessionId]);

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
  const additions = diffStats?.additions ?? 0;
  const deletions = diffStats?.deletions ?? 0;
  const filesChanged = diffStats?.files ?? 0;

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
                {baseBranch && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span>from {baseBranch}</span>
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

        <ReadyToMergeCard
          baseBranch={session?.base_branch}
          sessionBranch={session?.branch}
          sessionId={sessionId}
        />

        {(filesChanged > 0 || session?.description) && (
          <SectionPanel
            title="Changes"
            action={
              filesChanged > 0 ? (
                <DiffStat
                  added={additions}
                  removed={deletions}
                  files={filesChanged}
                />
              ) : undefined
            }
          >
            {session?.description && (
              <div className={styles.description}>{session.description}</div>
            )}
          </SectionPanel>
        )}

        {repoRoot && history.loaded && sessionHistoryEntries.length > 0 && (
          <SectionPanel
            title="Chat history"
            meta={`${sessionHistoryEntries.length} in this session`}
          >
            <div className={styles.historyWrap}>
              <ChatHistoryList
                entries={sessionHistoryEntries}
                repoRoot={repoRoot}
                onClearAll={() => history.clearAll()}
                onDelete={(historyId) => history.remove(historyId)}
                onResume={onResumeHistory}
                onView={onViewHistory}
              />
            </div>
          </SectionPanel>
        )}
      </div>
      {isRenamingBranch && session && (
        <RenameBranchDialog
          session={session}
          onClose={() => setIsRenamingBranch(false)}
        />
      )}
    </div>
  );
}
