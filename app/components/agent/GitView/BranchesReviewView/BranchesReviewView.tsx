/**
 * Branches Review — lists branches alongside
 * their PR + ahead/behind state, with filter chips for "needs attention",
 * "has PR", "no PR", and "stale". Reuses the data already loaded by the git
 * sidebar (no new IPC).
 */
import type { EnrichedBranch } from "../../../../lib/ipc";
import type { InterestingPullRequest } from "../../../../lib/types";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, Chip, EmptyState, Icons, Spinner } from "@argus/peacock";
import { gitListLocalBranches, openExternalUrl } from "../../../../lib/ipc";
import { usePrsByBranch } from "../../../../stores/pullRequestStore";
import styles from "./BranchesReviewView.module.css";

type FilterId = "ahead" | "all" | "has-pr" | "no-pr" | "stale";

const STALE_DAYS = 30;

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "has-pr", label: "Has PR" },
  { id: "no-pr", label: "No PR" },
  { id: "ahead", label: "Ahead of upstream" },
  { id: "stale", label: `Stale > ${STALE_DAYS}d` },
];

interface Props {
  defaultBranch?: string | null;
  repoRoot: string;
  sessionId: string;
}

export function BranchesReviewView({
  sessionId,
  repoRoot,
  defaultBranch,
}: Props) {
  const [branches, setBranches] = useState<EnrichedBranch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  // Snapshot "now" at load time. Stable for the row computation; refreshed
  // when branches reload (which is when stale-day calculations matter).
  const [now, setNow] = useState<number>(() => Date.now());
  const prsByBranch = usePrsByBranch(repoRoot);

  useEffect(() => {
    let cancelled = false;
    gitListLocalBranches(sessionId)
      .then((data) => {
        if (!cancelled) {
          setBranches(data);
          setNow(Date.now());
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const rows = useMemo(() => {
    if (!branches) {
      return [];
    }

    return branches
      .map((b) => {
        const pr = prsByBranch.get(b.name);
        const lastTs = (b.lastCommit?.timestamp ?? 0) * 1000;
        const ageDays =
          lastTs > 0 ? Math.round((now - lastTs) / 86400000) : null;

        return { branch: b, pr, ageDays };
      })
      .filter(({ branch, pr, ageDays }) => {
        if (filter === "has-pr") {
          return Boolean(pr);
        }
        if (filter === "no-pr") {
          return !pr && !branch.isCurrent && branch.name !== defaultBranch;
        }
        if (filter === "ahead") {
          return branch.ahead > 0;
        }
        if (filter === "stale") {
          return ageDays != null && ageDays > STALE_DAYS;
        }

        return true;
      })
      .sort((a, b) => {
        // Current branch first, then default branch, then by ahead desc.
        if (a.branch.isCurrent !== b.branch.isCurrent) {
          return a.branch.isCurrent ? -1 : 1;
        }
        if (
          (a.branch.name === defaultBranch) !==
          (b.branch.name === defaultBranch)
        ) {
          return a.branch.name === defaultBranch ? -1 : 1;
        }

        return b.branch.ahead - a.branch.ahead;
      });
  }, [branches, prsByBranch, filter, defaultBranch, now]);

  if (error) {
    return (
      <div className={styles.container}>
        <EmptyState
          icon={<Icons.WarningIcon size={20} />}
          title="Couldn't load branches"
          body={error}
        />
      </div>
    );
  }

  if (!branches) {
    return (
      <div className={styles.container}>
        <EmptyState
          icon={<Spinner size="md" />}
          title="Loading branches"
          body=""
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headTitle}>Branches Review</span>
        <span className={styles.headSub}>
          {rows.length} of {branches.length} branches
        </span>
      </div>
      <div className={styles.filters}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`${styles.filterChip} ${filter === f.id ? styles.filterActive : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" body="Try a different filter." />
      ) : (
        <div className={styles.list}>
          {rows.map(({ branch, pr, ageDays }) => (
            <ReviewRow
              key={branch.name}
              branch={branch}
              pr={pr}
              ageDays={ageDays}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface RowProps {
  ageDays: number | null;
  branch: EnrichedBranch;
  pr?: InterestingPullRequest;
}

function ReviewRow({ branch, pr, ageDays }: RowProps) {
  return (
    <Card hoverable className={styles.row}>
      <div className={styles.rowName}>
        <Icons.BranchIcon size={12} />
        <span className={styles.name}>{branch.name}</span>
        {branch.isCurrent && (
          <Badge tone="accent" size="tag">
            HEAD
          </Badge>
        )}
      </div>
      <div className={styles.rowMeta}>
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span className={styles.aheadBehind}>
            {branch.ahead > 0 ? <span>↑{branch.ahead}</span> : null}
            {branch.behind > 0 ? <span>↓{branch.behind}</span> : null}
          </span>
        )}
        {pr ? (
          <Chip
            muted
            mono
            onClick={() => openExternalUrl(pr.url).catch(() => undefined)}
            leading={<Icons.MergeIcon size={10} />}
          >
            #{pr.number}
          </Chip>
        ) : (
          <span className={styles.noPr}>no PR</span>
        )}
        {ageDays != null && (
          <span
            className={
              ageDays > STALE_DAYS ? styles.ageStale : styles.ageNormal
            }
          >
            {ageDays}d
          </span>
        )}
        <span className={styles.subject}>
          {branch.lastCommit?.subject ?? ""}
        </span>
      </div>
    </Card>
  );
}
