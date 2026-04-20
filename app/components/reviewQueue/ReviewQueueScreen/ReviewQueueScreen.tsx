import type { Session } from "../../../lib/types";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, Icons, SessionCard } from "@argus/peacock";
import { listen } from "../../../lib/events";
import { watchSession } from "../../../lib/ipc";
import { setActiveTool } from "../../../stores/layoutStore";
import { useReviewQueueMap } from "../../../stores/reviewQueueStore";
import { selectSession, useSessions } from "../../../stores/sessionStore";
import styles from "./ReviewQueueScreen.module.css";

function projectName(repoRoot: string): string {
  return repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? repoRoot;
}

function describeReviewState(
  commitsAhead: number,
  hasStaged: boolean,
  hasUncommitted: boolean,
  baseBranch: string | null | undefined,
): string {
  const parts: string[] = [];
  if (commitsAhead > 0) {
    parts.push(
      baseBranch
        ? `${commitsAhead} ahead of ${baseBranch}`
        : `${commitsAhead} unmerged commit${commitsAhead === 1 ? "" : "s"}`,
    );
  }
  if (hasStaged) {
    parts.push("staged changes");
  } else if (hasUncommitted) {
    parts.push("uncommitted changes");
  }

  return parts.join(" · ") || "No changes";
}

interface DiffStats {
  additions: number;
  deletions: number;
  files: number;
}

interface ReviewQueueRowProps {
  commitsAhead: number;
  hasStaged: boolean;
  hasUncommitted: boolean;
  onSelect: () => void;
  session: Session;
}

function ReviewQueueRow({
  session,
  commitsAhead,
  hasStaged,
  hasUncommitted,
  onSelect,
}: ReviewQueueRowProps) {
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<DiffStats>(
      `session:diff-changed:${session.id}`,
      (event) => {
        if (!cancelled) {
          setDiffStats(event.payload);
        }
      },
    );
    // Idempotent — re-emits current stats if already watching.
    watchSession(session.id).catch(() => {});

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [session.id]);

  let status: "accent" | "success" | "warning";
  if (commitsAhead > 0) {
    status = "success";
  } else if (hasStaged) {
    status = "accent";
  } else {
    status = "warning";
  }

  return (
    <SessionCard
      branch={session.display_name ?? session.branch}
      repo={projectName(session.repo_root)}
      parentBranch={describeReviewState(
        commitsAhead,
        hasStaged,
        hasUncommitted,
        session.base_branch,
      )}
      status={status}
      files={diffStats?.files}
      added={diffStats?.additions}
      removed={diffStats?.deletions}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={styles.row}
    />
  );
}

export function ReviewQueueScreen() {
  const entries = useReviewQueueMap();
  const sessions = useSessions();

  const items = useMemo(() => {
    const byId = new Map(sessions.map((w) => [w.id, w]));

    return Object.entries(entries)
      .map(([sessionId, entry]) => {
        const ws = byId.get(sessionId);
        if (!ws) {
          return null;
        }

        return { session: ws, ...entry };
      })
      .filter(
        (
          x,
        ): x is {
          commitsAhead: number;
          hasStaged: boolean;
          hasUncommitted: boolean;
          session: (typeof sessions)[0];
        } => x !== null,
      )
      .sort((a, b) => b.commitsAhead - a.commitsAhead);
  }, [entries, sessions]);

  const handleRowClick = (sessionId: string) => {
    selectSession(sessionId);
    setActiveTool("changes");
  };

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <span className={styles.title}>Review queue</span>
        <span className={styles.sub}>
          {items.length === 0
            ? "Nothing ready to review"
            : `${items.length} session${items.length === 1 ? "" : "s"} with unmerged changes`}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<Icons.MergeIcon size={20} />}
          title="No sessions awaiting review"
          body="When an agent completes changes on a branch, it appears here ready to merge into its parent."
        />
      ) : (
        <div className={styles.list}>
          {items.map(
            ({ session, commitsAhead, hasStaged, hasUncommitted }) => (
              <ReviewQueueRow
                key={session.id}
                session={session}
                commitsAhead={commitsAhead}
                hasStaged={hasStaged}
                hasUncommitted={hasUncommitted}
                onSelect={() => handleRowClick(session.id)}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
