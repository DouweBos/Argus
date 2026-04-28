import type {
  InterestingPullRequest,
  PullRequestReason,
} from "../../../lib/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  GridScreen,
  Icons,
  Spinner,
} from "@argus/peacock";
import {
  createSession as apiCreateSession,
  openExternalUrl,
} from "../../../lib/ipc";
import {
  ATTENTION_BUCKETS,
  BUCKET_LABEL,
  BUCKET_ORDER,
  type PrBucket,
  groupByBucket,
} from "../../../lib/pullRequestBucket";
import { appNavigate } from "../../../lib/router";
import { pushError } from "../../../stores/notificationsStore";
import {
  refreshPullRequestList,
  usePrList,
} from "../../../stores/pullRequestStore";
import {
  selectSession,
  useSessionProjects,
} from "../../../stores/sessionStore";
import styles from "./PullRequestsScreen.module.css";

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) {
    return "just now";
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min} min ago`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const days = Math.round(hr / 24);
  if (days < 30) {
    return `${days}d ago`;
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return `${months}mo ago`;
  }

  return `${Math.round(months / 12)}y ago`;
}

// Bucket helpers live in `app/lib/pullRequestBucket.ts` so the sidebar count
// badge can reuse the exact same classification.

const REASON_LABEL: Record<PullRequestReason, string> = {
  author: "Author",
  reviewer: "Reviewer",
  team: "Team review",
  commenter: "Commented",
  mentioned: "Mentioned",
};

function reasonTone(
  reason: PullRequestReason,
): "accent" | "neutral" | "success" {
  if (reason === "author") {
    return "accent";
  }
  if (reason === "reviewer" || reason === "team") {
    return "success";
  }

  return "neutral";
}

interface RowProps {
  busy: boolean;
  onOpenBrowser: (pr: InterestingPullRequest) => void;
  onOpenDetail: (pr: InterestingPullRequest) => void;
  onStart: (pr: InterestingPullRequest) => void;
  pr: InterestingPullRequest;
}

function PullRequestRow({
  pr,
  onOpenBrowser,
  onOpenDetail,
  onStart,
  busy,
}: RowProps) {
  return (
    <Card hoverable className={styles.row}>
      <div className={styles.rowMain} onClick={() => onOpenDetail(pr)}>
        <div className={styles.rowHead}>
          {pr.authorAvatarUrl ? (
            <img alt="" className={styles.avatar} src={pr.authorAvatarUrl} />
          ) : (
            <span className={styles.avatarFallback}>
              <Icons.AgentIcon size={12} />
            </span>
          )}
          <div className={styles.rowTitleBlock}>
            <div className={styles.rowTitleLine}>
              <span className={styles.title}>{pr.title}</span>
              {pr.isDraft && (
                <Badge tone="neutral" size="tag">
                  Draft
                </Badge>
              )}
            </div>
            <div className={styles.meta}>
              <span className={styles.repo}>{pr.repoNameWithOwner}</span>
              <span className={styles.metaSep}>·</span>
              <span>#{pr.number}</span>
              <span className={styles.metaSep}>·</span>
              <span>{pr.author ? `by ${pr.author}` : "unknown author"}</span>
              <span className={styles.metaSep}>·</span>
              <span>updated {relativeTime(pr.updatedAt)}</span>
            </div>
          </div>
        </div>
        <div className={styles.chips}>
          {pr.reasons.map((reason) => (
            <Badge key={reason} tone={reasonTone(reason)} size="tag">
              {REASON_LABEL[reason]}
            </Badge>
          ))}
          <Chip
            muted
            mono
            className={styles.branchChip}
            leading={<Icons.BranchIcon size={10} />}
          >
            {pr.headRefName}
          </Chip>
        </div>
      </div>
      <div className={styles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpenBrowser(pr);
          }}
          title="Open in browser"
          aria-label="Open in browser"
        >
          <Icons.WebIcon size={14} />
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onStart(pr);
          }}
          disabled={busy}
          leading={<Icons.PlusIcon size={12} />}
        >
          {busy ? "Starting…" : "New session"}
        </Button>
      </div>
    </Card>
  );
}

export function PullRequestsScreen() {
  const projects = useSessionProjects();
  const { data: items, error, loading } = usePrList();

  const repoRoots = useMemo(() => projects.map((p) => p.repoRoot), [projects]);
  const repoRootsKey = repoRoots.join("|");

  const refresh = useCallback(async () => {
    await refreshPullRequestList(repoRoots);
  }, [repoRoots]);

  // On mount / when the open-project set changes, kick a refresh. Cached
  // data (if any) stays visible underneath while the background fetch runs,
  // so returning to this screen doesn't wipe it.
  useEffect(() => {
    refresh().catch(() => {});
    // repoRootsKey covers project changes without re-firing on array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoRootsKey]);

  const handleOpenBrowser = useCallback((pr: InterestingPullRequest) => {
    openExternalUrl(pr.url).catch(() => {});
  }, []);

  const handleOpenDetail = useCallback((pr: InterestingPullRequest) => {
    const [owner, repo] = pr.repoNameWithOwner.split("/");
    if (!owner || !repo) {
      return;
    }
    appNavigate({
      view: "pull-request-detail",
      pr: { owner, repo, number: pr.number },
    });
  }, []);

  const [starting, setStarting] = useState<string | null>(null);
  const handleStart = useCallback(async (pr: InterestingPullRequest) => {
    setStarting(pr.url);
    try {
      const session = await apiCreateSession(
        pr.repoRoot,
        pr.headRefName,
        `PR #${pr.number}: ${pr.title}\n\n${pr.url}`,
        true,
        pr.baseRefName,
      );
      selectSession(session.id);
    } catch (err) {
      pushError(
        err instanceof Error ? err.message : String(err),
        "pr_new_session",
      );
    } finally {
      setStarting(null);
    }
  }, []);

  const groupedByBucket = groupByBucket(items ?? []);

  const hasCache = items !== null;
  let headSub = "";
  if (loading && !hasCache) {
    headSub = "Loading…";
  } else if (hasCache) {
    const base = `${items.length} open · authored, reviewing, or commented`;
    headSub = loading ? `${base} · refreshing…` : base;
  }

  const errorBody =
    error && (error.includes("gh: not found") || error.includes("ENOENT"))
      ? "The GitHub CLI (gh) is required. Install it and run `gh auth login`, then try again."
      : (error ?? "");

  const emptyBody =
    projects.length === 0
      ? "Open a project to see PRs from that repo here."
      : "When you're authoring, reviewing, or mentioned on a PR in one of your open projects, it'll appear here.";

  let content: ReactNode;
  if (!hasCache && error) {
    // Only take over the full screen with an error state if we have nothing
    // cached to show. Otherwise we surface refresh failures via the header.
    content = (
      <EmptyState
        icon={<Icons.WarningIcon size={20} />}
        title="Couldn't fetch pull requests"
        body={errorBody}
      />
    );
  } else if (!hasCache) {
    content = (
      <EmptyState
        icon={<Spinner size="md" />}
        title="Loading pull requests"
        body="Asking GitHub for PRs that involve you across your open projects."
      />
    );
  } else if (items.length === 0) {
    content = (
      <EmptyState
        icon={<Icons.ReviewQueueIcon size={20} />}
        title="No pull requests of interest"
        body={emptyBody}
      />
    );
  } else {
    const renderBucketSection = (bucket: PrBucket) => {
      const prs = groupedByBucket.get(bucket) ?? [];

      return (
        <GridScreen.Section
          key={bucket}
          title={BUCKET_LABEL[bucket]}
          count={prs.length}
        >
          <GridScreen.Grid>
            {prs.map((pr) => (
              <PullRequestRow
                key={pr.url}
                pr={pr}
                busy={starting === pr.url}
                onOpenBrowser={handleOpenBrowser}
                onOpenDetail={handleOpenDetail}
                onStart={handleStart}
              />
            ))}
          </GridScreen.Grid>
        </GridScreen.Section>
      );
    };

    const attentionBuckets = BUCKET_ORDER.filter(
      (bucket) => groupedByBucket.has(bucket) && ATTENTION_BUCKETS.has(bucket),
    );
    const quietBuckets = BUCKET_ORDER.filter(
      (bucket) => groupedByBucket.has(bucket) && !ATTENTION_BUCKETS.has(bucket),
    );
    const quietCount = quietBuckets.reduce(
      (sum, b) => sum + (groupedByBucket.get(b)?.length ?? 0),
      0,
    );

    content = (
      <>
        {attentionBuckets.length === 0 ? (
          <Card className={styles.allClear}>
            <Icons.CheckIcon size={14} />
            <span>Nothing waiting on you right now.</span>
          </Card>
        ) : (
          attentionBuckets.map(renderBucketSection)
        )}

        {quietBuckets.length > 0 && (
          <>
            <div className={styles.quietDivider}>
              <span className={styles.quietDividerLabel}>
                No immediate action
              </span>
              <span className={styles.quietDividerCount}>
                {quietCount} PR{quietCount === 1 ? "" : "s"}
              </span>
              <span className={styles.quietDividerRule} />
            </div>
            <div className={styles.quietBlock}>
              {quietBuckets.map(renderBucketSection)}
            </div>
          </>
        )}
      </>
    );
  }

  return (
    <GridScreen>
      <GridScreen.Header
        title="Pull requests"
        subtitle={headSub}
        actions={
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => {
              refresh().catch(() => {});
            }}
            leading={<Icons.RefreshIcon size={12} />}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      {content}
    </GridScreen>
  );
}
