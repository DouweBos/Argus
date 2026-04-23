import type {
  PullRequestCheck,
  PullRequestCommit,
  PullRequestDetail,
} from "../../../lib/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  Dialog,
  DiffStat,
  EmptyState,
  FileDiffCard,
  GridScreen,
  Icons,
  parseDiff,
} from "@argus/peacock";
import {
  createSession as apiCreateSession,
  openExternalUrl,
} from "../../../lib/ipc";
import { renderHtml } from "../../../lib/markdown";
import { useRoutePR } from "../../../lib/routeHooks";
import { appNavigate } from "../../../lib/router";
import { pushError } from "../../../stores/notificationsStore";
import {
  detailKey,
  refreshPullRequestDetail,
  refreshPullRequestDiff,
  usePrDetailState,
  usePrDiffState,
} from "../../../stores/pullRequestStore";
import {
  selectSession,
  useSessionProjects,
} from "../../../stores/sessionStore";
import { Markdown } from "../../shared/Markdown";
import styles from "./PullRequestDetailScreen.module.css";

function relativeTime(iso: string): string {
  if (!iso) {
    return "";
  }
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

function stateBadge(detail: PullRequestDetail): ReactNode {
  if (detail.merged) {
    return (
      <Badge tone="accent" size="tag">
        Merged
      </Badge>
    );
  }
  if (detail.state === "CLOSED") {
    return (
      <Badge tone="error" size="tag">
        Closed
      </Badge>
    );
  }
  if (detail.isDraft) {
    return (
      <Badge tone="neutral" size="tag">
        Draft
      </Badge>
    );
  }

  return (
    <Badge tone="success" size="tag">
      Open
    </Badge>
  );
}

function CheckBadge({ check }: { check: PullRequestCheck }) {
  const conclusion = check.conclusion;
  const status = check.status;
  if (conclusion === "success") {
    return (
      <span className={`${styles.checkIcon} ${styles.checkSuccess}`}>
        <Icons.CheckIcon size={10} />
      </span>
    );
  }
  if (
    conclusion === "failure" ||
    conclusion === "cancelled" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure"
  ) {
    return (
      <span className={`${styles.checkIcon} ${styles.checkFailure}`}>
        <Icons.CloseIcon size={10} />
      </span>
    );
  }
  if (
    !conclusion &&
    (status === "in_progress" || status === "pending" || status === "queued")
  ) {
    return (
      <span className={`${styles.checkIcon} ${styles.checkPending}`}>
        <Icons.ClockIcon size={10} />
      </span>
    );
  }

  return (
    <span className={`${styles.checkIcon} ${styles.checkNeutral}`}>
      <Icons.MinusIcon size={10} />
    </span>
  );
}

function reviewStateLabel(state: string | undefined): string {
  if (!state) {
    return "Commented";
  }
  if (state === "APPROVED") {
    return "Approved";
  }
  if (state === "CHANGES_REQUESTED") {
    return "Requested changes";
  }
  if (state === "DISMISSED") {
    return "Review dismissed";
  }

  return "Reviewed";
}

export function PullRequestDetailScreen() {
  const pr = useRoutePR();
  const projects = useSessionProjects();
  const [starting, setStarting] = useState(false);

  const key = pr ? detailKey(pr.owner, pr.repo, pr.number) : null;
  const { data: detail, error, loading } = usePrDetailState(key);

  const refresh = useCallback(async () => {
    if (!pr) {
      return;
    }
    await refreshPullRequestDetail(pr.owner, pr.repo, pr.number);
  }, [pr]);

  // Fire a background refresh whenever the route's PR changes. Any cached
  // detail stays visible while the request is in flight, so re-entering a
  // previously-viewed PR renders instantly.
  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const handleOpen = useCallback((url: string) => {
    openExternalUrl(url).catch(() => {});
  }, []);

  const handleStart = useCallback(async () => {
    if (!detail) {
      return;
    }
    const slug = detail.repoNameWithOwner.toLowerCase();
    const project = projects.find((p) => {
      const tail = p.repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? "";

      return slug.endsWith(`/${tail.toLowerCase()}`);
    });
    if (!project) {
      pushError(
        `No Argus project open for ${detail.repoNameWithOwner}.`,
        "pr_new_session",
      );

      return;
    }
    setStarting(true);
    try {
      const session = await apiCreateSession(
        project.repoRoot,
        detail.headRefName,
        `PR #${detail.number}: ${detail.title}\n\n${detail.url}`,
        true,
        detail.baseRefName,
      );
      selectSession(session.id);
    } catch (err) {
      pushError(
        err instanceof Error ? err.message : String(err),
        "pr_new_session",
      );
    } finally {
      setStarting(false);
    }
  }, [detail, projects]);

  const handleClose = useCallback(() => {
    appNavigate({ view: "pull-requests" });
  }, []);

  if (!pr) {
    return null;
  }

  let content: ReactNode;
  if (detail) {
    // Prefer showing cached data even while a background refresh or error
    // is happening, so navigating back to a previously-loaded PR is instant.
    content = <DetailBody detail={detail} onOpenUrl={handleOpen} />;
  } else if (error) {
    content = (
      <EmptyState
        icon={<Icons.WarningIcon size={20} />}
        title="Couldn't load pull request"
        body={error}
      />
    );
  } else {
    content = (
      <EmptyState
        icon={<Icons.RefreshIcon size={20} />}
        title="Loading pull request"
        body={`${pr.owner}/${pr.repo}#${pr.number}`}
      />
    );
  }

  const dialogTitle = detail ? (
    <div className={styles.dialogTitle}>
      <span className={styles.dialogTitleText}>{detail.title}</span>
      <span className={styles.titleNumber}>#{detail.number}</span>
    </div>
  ) : (
    <span className={styles.dialogTitleText}>
      {pr.owner}/{pr.repo}#{pr.number}
    </span>
  );

  return (
    <Dialog
      title={dialogTitle}
      titleId={`pr-detail-${pr.owner}-${pr.repo}-${pr.number}`}
      onClose={handleClose}
      size="full"
    >
      {detail && (
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.titleBlock}>
              <div className={styles.subLine}>
                {stateBadge(detail)}
                {detail.authorAvatarUrl && (
                  <img
                    alt=""
                    className={styles.subAvatar}
                    src={detail.authorAvatarUrl}
                  />
                )}
                <span>
                  {detail.author ?? "unknown"} wants to merge{" "}
                  <code>{detail.headRefName}</code> into{" "}
                  <code>{detail.baseRefName}</code>
                </span>
                <span>·</span>
                <span>updated {relativeTime(detail.updatedAt)}</span>
              </div>
            </div>
            <div className={styles.actionRow}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleOpen(detail.url)}
                title="Open in browser"
                aria-label="Open in browser"
              >
                <Icons.WebIcon size={14} />
              </Button>
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
              <Button
                variant="primary"
                size="sm"
                disabled={starting}
                onClick={() => {
                  handleStart().catch(() => {});
                }}
                leading={<Icons.PlusIcon size={12} />}
              >
                {starting ? "Starting…" : "New session"}
              </Button>
            </div>
          </div>
          <div className={styles.stats}>
            <span className={styles.statItem}>
              <Icons.BranchIcon size={12} />
              <strong>{detail.commits}</strong> commit
              {detail.commits === 1 ? "" : "s"}
            </span>
            <span className={styles.statItem}>
              <Icons.FileIcon size={12} />
              <strong>{detail.changedFiles}</strong> file
              {detail.changedFiles === 1 ? "" : "s"} changed
            </span>
            <span className={styles.statItem}>
              <DiffStat added={detail.additions} removed={detail.deletions} />
            </span>
            {detail.labels.length > 0 && (
              <span className={styles.labels}>
                {detail.labels.map((name) => (
                  <Chip key={name} muted>
                    {name}
                  </Chip>
                ))}
              </span>
            )}
          </div>
        </header>
      )}

      <div className={styles.dialogBody}>{content}</div>
    </Dialog>
  );
}

type DetailTab = "checks" | "commits" | "conversation" | "files";

function countChecksPassed(checks: PullRequestCheck[]): number {
  return checks.filter((c) => c.conclusion === "success").length;
}

function RichBody({
  bodyHtml,
  fallback,
}: {
  bodyHtml: string;
  fallback: string;
}) {
  // Prefer GitHub's pre-rendered HTML — it already resolves issue refs,
  // @mentions, emoji shortcodes, task lists and repo autolink rules.
  // Fall back to rendering the raw markdown ourselves when the HTML field
  // is empty (older API payloads, cached detail, etc).
  const html = useMemo(
    () => (bodyHtml.trim() ? renderHtml(bodyHtml) : null),
    [bodyHtml],
  );

  if (html != null) {
    return (
      <div
        className={styles.markdown}
        // Safe: runs DOMPurify with a strict allowlist.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return <Markdown className={styles.markdown} text={fallback} />;
}

function DetailBody({
  detail,
  onOpenUrl,
}: {
  detail: PullRequestDetail;
  onOpenUrl: (url: string) => void;
}) {
  const [tab, setTab] = useState<DetailTab>("conversation");

  const checksPassed = countChecksPassed(detail.checks);
  const tabs: { id: DetailTab; label: ReactNode }[] = [
    { id: "conversation", label: "Conversation" },
    { id: "commits", label: `Commits (${detail.commits})` },
    {
      id: "checks",
      label:
        detail.checks.length > 0
          ? `Checks (${checksPassed}/${detail.checks.length})`
          : "Checks",
    },
    { id: "files", label: `Files changed (${detail.changedFiles})` },
  ];

  return (
    <>
      <div
        className={styles.tabs}
        role="tablist"
        aria-label="Pull request sections"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "conversation" && (
        <ConversationTab detail={detail} onOpenUrl={onOpenUrl} />
      )}
      {tab === "commits" && (
        <CommitsTab detail={detail} onOpenUrl={onOpenUrl} />
      )}
      {tab === "checks" && <ChecksTab detail={detail} onOpenUrl={onOpenUrl} />}
      {tab === "files" && <FilesTab detail={detail} onOpenUrl={onOpenUrl} />}
    </>
  );
}

function viewOnGitHub(url: string, onOpenUrl: (url: string) => void) {
  return (
    <button
      type="button"
      className={styles.sectionLink}
      onClick={() => onOpenUrl(url)}
    >
      View on GitHub <Icons.PopoutIcon size={10} />
    </button>
  );
}

function ConversationTab({
  detail,
  onOpenUrl,
}: {
  detail: PullRequestDetail;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <>
      <GridScreen.Section title="Description">
        <Card className={styles.bodyCard}>
          {detail.body.trim() ? (
            <RichBody bodyHtml={detail.bodyHtml} fallback={detail.body} />
          ) : (
            <p className={`${styles.bodyText} ${styles.bodyEmpty}`}>
              No description.
            </p>
          )}
        </Card>
      </GridScreen.Section>

      <GridScreen.Section
        title="Conversation"
        count={detail.comments.length}
        actions={viewOnGitHub(detail.url, onOpenUrl)}
      >
        {detail.comments.length === 0 ? (
          <p className={styles.emptyLine}>No comments yet.</p>
        ) : (
          <ol className={styles.timeline}>
            {detail.comments.map((c) => (
              <li key={c.id} className={styles.timelineItem}>
                <div className={styles.timelineAvatar}>
                  {c.authorAvatarUrl ? (
                    <img alt="" src={c.authorAvatarUrl} />
                  ) : (
                    <Icons.AgentIcon size={14} />
                  )}
                </div>
                <Card className={styles.commentRow}>
                  <div className={styles.commentHead}>
                    <span className={styles.commentAuthor}>
                      {c.author ?? "unknown"}
                    </span>
                    {c.kind === "review" && (
                      <Badge tone="accent" size="tag">
                        {reviewStateLabel(c.reviewState)}
                      </Badge>
                    )}
                    <span>· {relativeTime(c.createdAt)}</span>
                    <button
                      type="button"
                      className={styles.sectionLink}
                      onClick={() => onOpenUrl(c.url)}
                    >
                      <Icons.PopoutIcon size={10} />
                    </button>
                  </div>
                  {c.body.trim() && (
                    <RichBody bodyHtml={c.bodyHtml} fallback={c.body} />
                  )}
                  {c.inlineComments && c.inlineComments.length > 0 && (
                    <ul className={styles.inlineThread}>
                      {c.inlineComments.map((ic) => (
                        <li key={ic.id} className={styles.inlineItem}>
                          <div className={styles.inlineHead}>
                            <span>{relativeTime(ic.createdAt)}</span>
                            <button
                              type="button"
                              className={styles.sectionLink}
                              onClick={() => onOpenUrl(ic.url)}
                              title="View inline comment on GitHub"
                              aria-label="View inline comment on GitHub"
                            >
                              <Icons.PopoutIcon size={10} />
                            </button>
                          </div>
                          <RichBody bodyHtml={ic.bodyHtml} fallback={ic.body} />
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </li>
            ))}
          </ol>
        )}
      </GridScreen.Section>

      <div className={styles.checksSummaryWrap}>
        <ChecksSummary detail={detail} onOpenUrl={onOpenUrl} />
      </div>
    </>
  );
}

function ChecksSummary({
  detail,
  onOpenUrl,
}: {
  detail: PullRequestDetail;
  onOpenUrl: (url: string) => void;
}) {
  if (detail.checks.length === 0) {
    return null;
  }
  const passed = countChecksPassed(detail.checks);
  const failed = detail.checks.filter(
    (c) =>
      c.conclusion === "failure" ||
      c.conclusion === "cancelled" ||
      c.conclusion === "timed_out" ||
      c.conclusion === "startup_failure",
  ).length;
  const pending = detail.checks.filter(
    (c) =>
      !c.conclusion &&
      (c.status === "in_progress" ||
        c.status === "pending" ||
        c.status === "queued"),
  ).length;

  let summaryTitle: string;
  let tone: "error" | "success" | "warning";
  if (failed > 0) {
    summaryTitle = `${failed} check${failed === 1 ? "" : "s"} failing`;
    tone = "error";
  } else if (pending > 0) {
    summaryTitle = `${pending} check${pending === 1 ? "" : "s"} in progress`;
    tone = "warning";
  } else {
    summaryTitle = "All checks have passed";
    tone = "success";
  }

  return (
    <Card className={`${styles.checksSummary} ${styles[`summary_${tone}`]}`}>
      <div className={styles.checksSummaryHead}>
        <span className={styles.checksSummaryTitle}>{summaryTitle}</span>
        <span className={styles.checksSummarySub}>
          {passed} passing · {failed} failing · {pending} pending ·{" "}
          {detail.checks.length} total
        </span>
        <button
          type="button"
          className={styles.sectionLink}
          onClick={() => onOpenUrl(`${detail.url}/checks`)}
        >
          Details <Icons.PopoutIcon size={10} />
        </button>
      </div>
      <div className={styles.checksSummaryRows}>
        {detail.checks.slice(0, 6).map((check, i) => (
          <div
            key={`${check.name}-${i}`}
            className={styles.checkRow}
            onClick={() => {
              if (check.detailsUrl) {
                onOpenUrl(check.detailsUrl);
              }
            }}
          >
            <CheckBadge check={check} />
            <span className={styles.checkName}>{check.name}</span>
          </div>
        ))}
        {detail.checks.length > 6 && (
          <p className={styles.emptyLine}>
            + {detail.checks.length - 6} more — see the Checks tab.
          </p>
        )}
      </div>
    </Card>
  );
}

function CommitsTab({
  detail,
  onOpenUrl,
}: {
  detail: PullRequestDetail;
  onOpenUrl: (url: string) => void;
}) {
  if (detail.commitList.length === 0) {
    return (
      <GridScreen.Section title="Commits" count={detail.commits}>
        <p className={styles.emptyLine}>No commits listed.</p>
      </GridScreen.Section>
    );
  }

  return (
    <GridScreen.Section
      title="Commits"
      count={detail.commits}
      actions={viewOnGitHub(`${detail.url}/commits`, onOpenUrl)}
    >
      <div className={styles.commitList}>
        {detail.commitList.map((commit) => (
          <CommitRow
            key={commit.oid}
            commit={commit}
            onOpen={() => onOpenUrl(commit.url)}
          />
        ))}
      </div>
    </GridScreen.Section>
  );
}

function CommitRow({
  commit,
  onOpen,
}: {
  commit: PullRequestCommit;
  onOpen: () => void;
}) {
  const firstLine = commit.message.split("\n")[0] ?? commit.message;
  let rollupIcon: ReactNode = null;
  if (commit.statusRollup === "success") {
    rollupIcon = (
      <span className={`${styles.checkIcon} ${styles.checkSuccess}`}>
        <Icons.CheckIcon size={10} />
      </span>
    );
  } else if (
    commit.statusRollup === "failure" ||
    commit.statusRollup === "error"
  ) {
    rollupIcon = (
      <span className={`${styles.checkIcon} ${styles.checkFailure}`}>
        <Icons.CloseIcon size={10} />
      </span>
    );
  } else if (commit.statusRollup === "pending") {
    rollupIcon = (
      <span className={`${styles.checkIcon} ${styles.checkPending}`}>
        <Icons.ClockIcon size={10} />
      </span>
    );
  }

  return (
    <div className={styles.commitRow} onClick={onOpen}>
      {commit.authorAvatarUrl && (
        <img
          alt=""
          className={styles.commentAvatar}
          src={commit.authorAvatarUrl}
        />
      )}
      <div className={styles.commitBody}>
        <span className={styles.commitMessage}>{firstLine}</span>
        <span className={styles.commitMeta}>
          {commit.author ?? "unknown"} · {relativeTime(commit.committedDate)}
        </span>
      </div>
      {rollupIcon}
      <code className={styles.commitOid}>{commit.abbreviatedOid}</code>
    </div>
  );
}

function ChecksTab({
  detail,
  onOpenUrl,
}: {
  detail: PullRequestDetail;
  onOpenUrl: (url: string) => void;
}) {
  return (
    <GridScreen.Section
      title="Checks"
      count={detail.checks.length}
      actions={viewOnGitHub(`${detail.url}/checks`, onOpenUrl)}
    >
      {detail.checks.length === 0 ? (
        <p className={styles.emptyLine}>No checks reported.</p>
      ) : (
        <GridScreen.Grid>
          {detail.checks.map((check, i) => (
            <div
              key={`${check.name}-${i}`}
              className={styles.checkRow}
              onClick={() => {
                if (check.detailsUrl) {
                  onOpenUrl(check.detailsUrl);
                }
              }}
            >
              <CheckBadge check={check} />
              <span className={styles.checkName}>{check.name}</span>
              {check.description && (
                <span className={styles.checkDesc}>{check.description}</span>
              )}
              {check.detailsUrl && <Icons.PopoutIcon size={10} />}
            </div>
          ))}
        </GridScreen.Grid>
      )}
    </GridScreen.Section>
  );
}

function FilesTab({
  detail,
  onOpenUrl,
}: {
  detail: PullRequestDetail;
  onOpenUrl: (url: string) => void;
}) {
  const key = detailKey(
    detail.repoNameWithOwner.split("/")[0] ?? "",
    detail.repoNameWithOwner.split("/")[1] ?? "",
    detail.number,
  );
  const { data: raw, error, loading } = usePrDiffState(key);

  // Lazy-load the raw diff the first time the Files tab becomes visible —
  // most PR detail opens never look at the diff, so we avoid the extra
  // round-trip on the common path.
  useEffect(() => {
    const [owner, repo] = detail.repoNameWithOwner.split("/");
    if (owner && repo) {
      refreshPullRequestDiff(owner, repo, detail.number).catch(() => {});
    }
  }, [detail.repoNameWithOwner, detail.number]);

  const files = useMemo(() => (raw ? parseDiff(raw) : []), [raw]);
  const hasCache = raw !== null;

  let headerLabel: string;
  if (loading && !hasCache) {
    headerLabel = "Loading diff…";
  } else if (hasCache) {
    headerLabel = loading ? `${files.length} files · refreshing…` : "";
  } else {
    headerLabel = "";
  }

  let content: ReactNode;
  if (!hasCache && error) {
    content = (
      <EmptyState
        icon={<Icons.WarningIcon size={20} />}
        title="Couldn't load diff"
        body={error}
      />
    );
  } else if (!hasCache) {
    content = (
      <EmptyState
        icon={<Icons.RefreshIcon size={20} />}
        title="Loading diff"
        body={`${detail.changedFiles} file${detail.changedFiles === 1 ? "" : "s"} changed`}
      />
    );
  } else if (files.length === 0) {
    content = (
      <EmptyState
        icon={<Icons.FileIcon size={20} />}
        title="No textual diff"
        body="This PR has no parseable file changes (binary-only, or an unusual patch shape). View it on GitHub for the full picture."
      />
    );
  } else {
    content = (
      <div className={styles.diffList}>
        {files.map((file) => (
          <FileDiffCard
            key={file.newPath || file.oldPath}
            file={file}
            headerActions={
              <button
                type="button"
                className={styles.sectionLink}
                onClick={() => onOpenUrl(`${detail.url}/files`)}
                title="View on GitHub"
                aria-label="View on GitHub"
              >
                <Icons.PopoutIcon size={10} />
              </button>
            }
          />
        ))}
      </div>
    );
  }

  return (
    <GridScreen.Section
      title="Files changed"
      count={
        headerLabel
          ? `${detail.changedFiles} · ${headerLabel}`
          : detail.changedFiles
      }
      actions={viewOnGitHub(`${detail.url}/files`, onOpenUrl)}
    >
      {content}
    </GridScreen.Section>
  );
}
