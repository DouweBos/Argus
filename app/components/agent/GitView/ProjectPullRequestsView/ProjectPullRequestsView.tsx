/**
 * Project-scoped Pull Requests view — same primitives as the global Pull
 * Requests screen, but filtered to a single project's `repoRoot`. Lives here
 * so the project Workspace nav has a Pull Requests entry without leaving the
 * git view.
 */
import type { InterestingPullRequest } from "../../../../lib/types";
import { useCallback, useEffect } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Icons,
  Spinner,
} from "@argus/peacock";
import { openExternalUrl } from "../../../../lib/ipc";
import { appNavigate } from "../../../../lib/router";
import {
  refreshPullRequestList,
  usePrList,
  usePrsForRepo,
} from "../../../../stores/pullRequestStore";
import { useSessionProjects } from "../../../../stores/sessionStore";
import styles from "./ProjectPullRequestsView.module.css";

interface Props {
  repoRoot: string;
}

function relativeTime(iso: string): string {
  const sec = Math.max(
    0,
    Math.round((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (sec < 60) {
    return "just now";
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m ago`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h ago`;
  }
  const days = Math.round(hr / 24);

  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
}

export function ProjectPullRequestsView({ repoRoot }: Props) {
  const projects = useSessionProjects();
  const { loading, error, data } = usePrList();
  const prs = usePrsForRepo(repoRoot);

  // Trigger a refresh against the full open-project set; the global cache
  // already drives the background poll, this just nudges on first paint.
  const refresh = useCallback(async () => {
    const roots = projects.map((p) => p.repoRoot);
    if (roots.length > 0) {
      await refreshPullRequestList(roots);
    }
  }, [projects]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const openInBrowser = (pr: InterestingPullRequest) => {
    openExternalUrl(pr.url).catch(() => undefined);
  };

  const openDetail = (pr: InterestingPullRequest) => {
    const [owner, repo] = pr.repoNameWithOwner.split("/");
    if (!owner || !repo) {
      return;
    }
    appNavigate({
      view: "pull-request-detail",
      pr: { owner, repo, number: pr.number },
    });
  };

  if (data === null && loading) {
    return (
      <div className={styles.container}>
        <EmptyState
          icon={<Spinner size="md" />}
          title="Loading pull requests"
          body="Asking GitHub for PRs from this project."
        />
      </div>
    );
  }

  if (data === null && error) {
    return (
      <div className={styles.container}>
        <EmptyState
          icon={<Icons.WarningIcon size={20} />}
          title="Couldn't fetch pull requests"
          body={error}
        />
      </div>
    );
  }

  if (prs.length === 0) {
    return (
      <div className={styles.container}>
        <EmptyState
          icon={<Icons.MergeIcon size={20} />}
          title="No open pull requests"
          body="When this project has open PRs that involve you, they'll show up here."
        />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.headTitle}>Pull Requests</span>
        <span className={styles.headSub}>
          {prs.length} open · authored, reviewing, or commented
          {loading ? " · refreshing…" : ""}
        </span>
      </div>
      <div className={styles.list}>
        {prs.map((pr) => (
          <PrRow
            key={pr.url}
            pr={pr}
            onOpenBrowser={openInBrowser}
            onOpenDetail={openDetail}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  onOpenBrowser: (pr: InterestingPullRequest) => void;
  onOpenDetail: (pr: InterestingPullRequest) => void;
  pr: InterestingPullRequest;
}

function PrRow({ pr, onOpenBrowser, onOpenDetail }: RowProps) {
  return (
    <Card hoverable className={styles.row} onClick={() => onOpenDetail(pr)}>
      <div className={styles.rowMain}>
        <div className={styles.rowTitleLine}>
          <span className={styles.title}>{pr.title}</span>
          {pr.isDraft && (
            <Badge tone="neutral" size="tag">
              Draft
            </Badge>
          )}
        </div>
        <div className={styles.meta}>
          <span>#{pr.number}</span>
          <span className={styles.metaSep}>·</span>
          <span>{pr.author ? `by ${pr.author}` : "unknown author"}</span>
          <span className={styles.metaSep}>·</span>
          <span>updated {relativeTime(pr.updatedAt)}</span>
        </div>
        <div className={styles.chips}>
          <Chip
            muted
            mono
            className={styles.branchChip}
            leading={<Icons.BranchIcon size={10} />}
          >
            {pr.headRefName}
          </Chip>
          <span className={styles.metaSep}>→</span>
          <Chip muted mono className={styles.branchChip}>
            {pr.baseRefName}
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
      </div>
    </Card>
  );
}
