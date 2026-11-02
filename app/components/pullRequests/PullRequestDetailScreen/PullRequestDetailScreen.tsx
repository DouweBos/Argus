import type {
  PullRequestCheck,
  PullRequestCommit,
  PullRequestDetail,
} from "../../../lib/types";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  checksSummary,
  checkTone,
  prMergeStrategyLabel,
  prStateLabel,
  relativeTime,
  reviewStateLabel,
} from "@argus/client-core";
import {
  Button,
  Card,
  DestructiveConfirm,
  Dialog,
  DialogBody,
  DialogFooter,
  EmptyState,
  FileDiffCard,
  GridScreen,
  Icons,
  type PullRequestCheck as PullRequestCheckView,
  PullRequestCheckIcon,
  PullRequestCheckList,
  PullRequestChecksSummary,
  PullRequestCommentBox,
  PullRequestEmptyLine,
  PullRequestHeader,
  PullRequestSectionLink,
  PullRequestTabs,
  PullRequestTimeline,
  SegmentedControl,
  Spinner,
  parseDiff,
} from "@argus/peacock";
import {
  createSession as apiCreateSession,
  ghPrClose,
  ghPrComment,
  ghPrMerge,
  openExternalUrl,
  type MergeStrategy,
} from "../../../lib/ipc";
import { renderHtml } from "../../../lib/markdown";
import { useRoutePR } from "../../../lib/routeHooks";
import { appNavigate } from "../../../lib/router";
import { pushError } from "../../../stores/notificationsStore";
import {
  detailKey,
  invalidatePullRequest,
  refreshPullRequestDetail,
  refreshPullRequestDiff,
  refreshPullRequestList,
  usePrDetailState,
  usePrDiffState,
} from "../../../stores/pullRequestStore";
import {
  selectSession,
  useSessionProjects,
  useSessions,
} from "../../../stores/sessionStore";
import { Markdown } from "../../shared/Markdown";
import styles from "./PullRequestDetailScreen.module.css";

function checkView(check: PullRequestCheck): PullRequestCheckView {
  return {
    name: check.name,
    tone: checkTone(check.conclusion, check.status),
    description: check.description,
    url: check.detailsUrl,
  };
}

export function PullRequestDetailScreen() {
  const pr = useRoutePR();
  const projects = useSessionProjects();
  const sessions = useSessions();
  const [starting, setStarting] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState<MergeStrategy>("squash");
  const [merging, setMerging] = useState(false);
  const [closing, setClosing] = useState(false);

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

  const matchingProject = useMemo(() => {
    if (!detail) {
      return null;
    }
    const slug = detail.repoNameWithOwner.toLowerCase();

    return (
      projects.find((p) => {
        const tail = p.repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? "";

        return slug.endsWith(`/${tail.toLowerCase()}`);
      }) ?? null
    );
  }, [detail, projects]);

  const existingSessionId = useMemo(() => {
    if (!detail || !matchingProject) {
      return null;
    }

    return (
      sessions.find(
        (s) =>
          s.kind === "worktree" &&
          s.repo_root === matchingProject.repoRoot &&
          s.branch === detail.headRefName,
      )?.id ?? null
    );
  }, [detail, matchingProject, sessions]);

  const handleStart = useCallback(async () => {
    if (!detail) {
      return;
    }
    const project = matchingProject;
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
  }, [detail, matchingProject]);

  const handleMerge = useCallback(async () => {
    if (!pr) {
      return;
    }
    setMerging(true);
    setMergeDialogOpen(false);
    try {
      await ghPrMerge({
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        strategy: mergeStrategy,
      });
      invalidatePullRequest(pr.owner, pr.repo, pr.number);
      const repoRoots = projects.map((p) => p.repoRoot);
      refreshPullRequestList(repoRoots).catch(() => {});
      // Refresh detail so state shows as merged.
      refresh().catch(() => {});
    } catch (err) {
      pushError(err instanceof Error ? err.message : String(err), "pr_merge");
    } finally {
      setMerging(false);
    }
  }, [pr, mergeStrategy, projects, refresh]);

  const handleClosePr = useCallback(async () => {
    if (!pr) {
      return;
    }
    setClosing(true);
    setCloseDialogOpen(false);
    try {
      await ghPrClose({
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
      });
      invalidatePullRequest(pr.owner, pr.repo, pr.number);
      const repoRoots = projects.map((p) => p.repoRoot);
      refreshPullRequestList(repoRoots).catch(() => {});
      appNavigate({ view: "pull-requests" });
    } catch (err) {
      pushError(err instanceof Error ? err.message : String(err), "pr_close");
      setClosing(false);
    }
  }, [pr, projects]);

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
    content = (
      <DetailBody
        detail={detail}
        onOpenUrl={handleOpen}
        onCommentPosted={() => {
          if (pr) {
            invalidatePullRequest(pr.owner, pr.repo, pr.number);
            refresh().catch(() => {});
          }
        }}
      />
    );
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
        icon={<Spinner size="md" />}
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

  const isOpen = !detail?.merged && detail?.state === "OPEN";

  return (
    <>
      {mergeDialogOpen && pr && (
        <MergeConfirmDialog
          strategy={mergeStrategy}
          onStrategyChange={setMergeStrategy}
          onConfirm={() => {
            handleMerge().catch(() => {});
          }}
          onCancel={() => setMergeDialogOpen(false)}
        />
      )}
      <DestructiveConfirm
        open={closeDialogOpen}
        title="Close pull request"
        description={`Are you sure you want to close PR #${pr?.number} without merging?`}
        confirmLabel={closing ? "Closing…" : "Close PR"}
        onConfirm={() => {
          handleClosePr().catch(() => {});
        }}
        onCancel={() => setCloseDialogOpen(false)}
      />
      <Dialog
        title={dialogTitle}
        titleId={`pr-detail-${pr.owner}-${pr.repo}-${pr.number}`}
        onClose={handleClose}
        size="full"
      >
        {detail && (
          <PullRequestHeader
            state={prStateLabel(detail)}
            author={detail.author}
            avatarUrl={detail.authorAvatarUrl}
            headRef={detail.headRefName}
            baseRef={detail.baseRefName}
            updated={relativeTime(detail.updatedAt)}
            commits={detail.commits}
            changedFiles={detail.changedFiles}
            additions={detail.additions}
            deletions={detail.deletions}
            labels={detail.labels}
            actions={
              <>
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
                {isOpen && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={closing}
                    onClick={() => setCloseDialogOpen(true)}
                  >
                    {closing ? "Closing…" : "Close PR"}
                  </Button>
                )}
                {isOpen && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={merging}
                    onClick={() => setMergeDialogOpen(true)}
                    leading={<Icons.MergeIcon size={12} />}
                  >
                    {merging ? "Merging…" : "Merge"}
                  </Button>
                )}
                {existingSessionId ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => selectSession(existingSessionId)}
                    leading={<Icons.ArrowUpRightIcon size={12} />}
                  >
                    Open session
                  </Button>
                ) : (
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
                )}
              </>
            }
          />
        )}

        <DialogBody>{content}</DialogBody>
      </Dialog>
    </>
  );
}

type DetailTab = "checks" | "commits" | "conversation" | "files";

function countChecksPassed(checks: PullRequestCheck[]): number {
  return checks.filter((c) => c.conclusion === "success").length;
}

const MERGE_STRATEGY_OPTIONS: {
  label: string;
  value: MergeStrategy;
}[] = [
  { value: "squash", label: "Squash" },
  { value: "merge", label: "Merge" },
  { value: "rebase", label: "Rebase" },
];

function MergeConfirmDialog({
  strategy,
  onStrategyChange,
  onConfirm,
  onCancel,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  onStrategyChange: (s: MergeStrategy) => void;
  strategy: MergeStrategy;
}) {
  return (
    <Dialog
      title="Merge pull request"
      titleId="pr-merge-confirm"
      onClose={onCancel}
    >
      <DialogBody>
        <p className={styles.mergeDialogText}>
          Select a merge strategy and confirm.
        </p>
        <SegmentedControl
          aria-label="Merge strategy"
          options={MERGE_STRATEGY_OPTIONS}
          value={strategy}
          onChange={onStrategyChange}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={onConfirm}
          leading={<Icons.MergeIcon size={12} />}
        >
          {prMergeStrategyLabel(strategy)}
        </Button>
      </DialogFooter>
    </Dialog>
  );
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
  onCommentPosted,
}: {
  detail: PullRequestDetail;
  onCommentPosted: () => void;
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
      <PullRequestTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === "conversation" && (
        <ConversationTab
          detail={detail}
          onOpenUrl={onOpenUrl}
          onCommentPosted={onCommentPosted}
        />
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
    <PullRequestSectionLink onClick={() => onOpenUrl(url)}>
      View on GitHub
    </PullRequestSectionLink>
  );
}

function ConversationTab({
  detail,
  onOpenUrl,
  onCommentPosted,
}: {
  detail: PullRequestDetail;
  onCommentPosted: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [owner, repo] = detail.repoNameWithOwner.split("/");

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
        <PullRequestTimeline
          onOpenUrl={onOpenUrl}
          entries={detail.comments.map((c) => ({
            id: c.id,
            author: c.author,
            avatarUrl: c.authorAvatarUrl,
            review:
              c.kind === "review" ? reviewStateLabel(c.reviewState) : null,
            age: relativeTime(c.createdAt),
            url: c.url,
            body: c.body.trim() ? (
              <RichBody bodyHtml={c.bodyHtml} fallback={c.body} />
            ) : null,
            inline: c.inlineComments?.map((ic) => ({
              id: ic.id,
              age: relativeTime(ic.createdAt),
              url: ic.url,
              body: <RichBody bodyHtml={ic.bodyHtml} fallback={ic.body} />,
            })),
          }))}
        />
      </GridScreen.Section>

      <ChecksSummary detail={detail} onOpenUrl={onOpenUrl} />

      {owner && repo && !detail.merged && detail.state === "OPEN" && (
        <GridScreen.Section title="Add a comment">
          <PullRequestCommentBox
            onSubmit={async (body) => {
              await ghPrComment({ owner, repo, number: detail.number, body });
              onCommentPosted();
            }}
          />
        </GridScreen.Section>
      )}
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
  const summary = checksSummary(detail.checks);
  if (!summary) {
    return null;
  }

  return (
    <PullRequestChecksSummary
      checks={detail.checks.map(checkView)}
      summary={summary}
      onOpenDetails={() => onOpenUrl(`${detail.url}/checks`)}
      onOpenUrl={onOpenUrl}
    />
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
        <PullRequestEmptyLine>No commits listed.</PullRequestEmptyLine>
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
    rollupIcon = <PullRequestCheckIcon tone="success" />;
  } else if (
    commit.statusRollup === "failure" ||
    commit.statusRollup === "error"
  ) {
    rollupIcon = <PullRequestCheckIcon tone="error" />;
  } else if (commit.statusRollup === "pending") {
    rollupIcon = <PullRequestCheckIcon tone="warning" />;
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
      <PullRequestCheckList
        checks={detail.checks.map(checkView)}
        onOpenUrl={onOpenUrl}
      />
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
        icon={<Spinner size="md" />}
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
              <PullRequestSectionLink
                label="View on GitHub"
                onClick={() => onOpenUrl(`${detail.url}/files`)}
              />
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
