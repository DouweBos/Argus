import { useEffect, useMemo, useState } from "react";
import { Button, Icons } from "@argus/peacock";
import { useArgusConfigVersion } from "../../../hooks/useArgusConfigVersion";
import { useMergeStatus } from "../../../hooks/useMergeStatus";
import { readArgusConfig } from "../../../lib/ipc";
import { useSessions } from "../../../stores/sessionStore";
import styles from "./MergeAction.module.css";

interface MergeActionProps {
  sessionId: string;
}

export function MergeAction({ sessionId }: MergeActionProps) {
  const sessions = useSessions();
  const session = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  );
  const { conflicts, hasStaged, commitsAhead, isMerging, handleMerge } =
    useMergeStatus(sessionId);

  const [isProtectedBase, setIsProtectedBase] = useState(false);
  const configVersion = useArgusConfigVersion(session?.repo_root ?? null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!session?.repo_root || !session.base_branch) {
        if (!cancelled) {
          setIsProtectedBase(false);
        }

        return;
      }
      try {
        const config = await readArgusConfig(session.repo_root);
        if (cancelled) {
          return;
        }
        const protectedList = config.protected_branches ?? [];
        setIsProtectedBase(
          session.base_branch
            ? protectedList.includes(session.base_branch)
            : false,
        );
      } catch {
        if (!cancelled) {
          setIsProtectedBase(false);
        }
      }
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [session?.repo_root, session?.base_branch, configVersion]);

  if (!session || session.kind !== "worktree" || !session.base_branch) {
    return null;
  }

  const hasConflicts = conflicts.length > 0;
  const hasMergeableWork = hasStaged || commitsAhead > 0;

  if (!hasMergeableWork && !hasConflicts) {
    return null;
  }

  if (isProtectedBase) {
    // Protected base requires the push & PR flow that lives on the runtime
    // MergeBar. Surface a hint here; the row's "Open session" button is the
    // path forward.
    return (
      <div className={styles.row} data-tone="muted">
        <span className={styles.status}>
          {session.base_branch} is protected — open the session to push
        </span>
      </div>
    );
  }

  const canMerge = hasMergeableWork && !hasConflicts && !isMerging;

  let label: string;
  let tone: "conflict" | "ready";
  if (hasConflicts) {
    label = `${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`;
    tone = "conflict";
  } else if (commitsAhead > 0 && !hasStaged) {
    label = `${commitsAhead} commit${commitsAhead === 1 ? "" : "s"} ready`;
    tone = "ready";
  } else {
    label = "Ready to merge";
    tone = "ready";
  }

  const title = hasConflicts
    ? `Resolve conflicts in this session before merging into ${session.base_branch}`
    : `Merge ${session.branch} into ${session.base_branch}`;

  return (
    <div className={styles.row} data-tone={tone}>
      <span className={styles.status}>{label}</span>
      <Button
        disabled={!canMerge}
        leading={<Icons.MergeIcon size={11} />}
        size="sm"
        variant="primary"
        title={title}
        onClick={() => {
          handleMerge();
        }}
      >
        {isMerging ? "Merging..." : `Merge → ${session.base_branch}`}
      </Button>
    </div>
  );
}
