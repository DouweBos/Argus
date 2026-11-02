/**
 * `/pull-requests/:owner/:repo/:number`: one PR — what it says, whether CI is
 * happy, what was said about it, and for a browser holding `control`, merge
 * (the remembered strategy, as every app shares it) and comment.
 */

import type { RemotePullRequestDetail } from "@argus/remote-protocol";
import { useCallback, useState } from "react";
import {
  checksSummary,
  checkTone,
  describeError,
  parsePrMergeStrategy,
  PR_MERGE_STRATEGIES,
  PR_MERGE_STRATEGY_KEY,
  type PrMergeStrategy,
  prMergeStrategyLabel,
  prStateLabel,
  relativeTime,
  reviewStateLabel,
} from "@argus/client-core";
import {
  Banner,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  GridScreen,
  Icons,
  Markdown,
  MergeSplitButton,
  type PullRequestCheck,
  PullRequestCheckList,
  PullRequestChecksSummary,
  PullRequestCommentBox,
  PullRequestEmptyLine,
  PullRequestHeader,
  PullRequestTabs,
  PullRequestTimeline,
  Spinner,
} from "@argus/peacock";
import { useConnectionStore } from "../../stores/connection";
import {
  pullRequestKey,
  usePullRequestsStore,
} from "../../stores/pullRequests";
import { useLiveRefresh } from "../useLiveRefresh";

type Tab = "checks" | "conversation";

function openExternal(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function rememberedStrategy(): PrMergeStrategy {
  try {
    return parsePrMergeStrategy(localStorage.getItem(PR_MERGE_STRATEGY_KEY));
  } catch {
    return "squash";
  }
}

function checkViews(detail: RemotePullRequestDetail): PullRequestCheck[] {
  return detail.checks.map((c) => ({
    name: c.name,
    tone: checkTone(c.conclusion, c.status),
    description: c.conclusion ?? c.status,
  }));
}

export function PullRequestScreen({
  number,
  owner,
  repo,
}: {
  number: number;
  owner: string;
  repo: string;
}) {
  const slug = `${owner}/${repo}`;
  const key = pullRequestKey(slug, number);
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const detail = usePullRequestsStore((s) => s.detailById[key]);
  const error = usePullRequestsStore((s) => s.detailErrorById[key]);
  const [tab, setTab] = useState<Tab>("conversation");
  const [strategy, setStrategy] = useState<PrMergeStrategy>(rememberedStrategy);
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void usePullRequestsStore
      .getState()
      .loadDetail(slug, number, { background: true });
  }, [slug, number]);
  useLiveRefresh(ready, refresh, 30_000);

  if (!detail) {
    return error ? (
      <EmptyState
        icon={<Icons.WarningIcon size={22} />}
        title="Couldn't read that pull request"
        body={error}
      />
    ) : (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Reading the pull request…</span>
      </div>
    );
  }

  const checks = checkViews(detail);
  const summary = checksSummary(detail.checks);
  const conflicting = detail.mergeable === "CONFLICTING";
  const open = !detail.merged && detail.state === "OPEN";

  const pickStrategy = (next: PrMergeStrategy) => {
    setStrategy(next);
    try {
      localStorage.setItem(PR_MERGE_STRATEGY_KEY, next);
    } catch {
      // Private mode: remembered for this screen only.
    }
  };

  return (
    <GridScreen plain className="aw-ship-grid">
      <h2 className="aw-ship-title">
        {detail.title} <span className="aw-muted">#{detail.number}</span>
      </h2>
      <PullRequestHeader
        state={prStateLabel({
          merged: detail.merged,
          state: detail.state,
          isDraft: detail.is_draft,
        })}
        author={detail.author}
        headRef={detail.head_ref}
        baseRef={detail.base_ref}
        changedFiles={detail.changed_files}
        additions={detail.additions}
        deletions={detail.deletions}
        conflicting={conflicting}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              title="Open on GitHub"
              aria-label="Open on GitHub"
              onClick={() => openExternal(detail.url)}
            >
              <Icons.WebIcon size={14} />
            </Button>
            {hasControl && open && (
              <MergeSplitButton
                strategy={strategy}
                options={PR_MERGE_STRATEGIES.map((s) => ({
                  value: s,
                  label: prMergeStrategyLabel(s),
                }))}
                onStrategyChange={pickStrategy}
                onMerge={() => setConfirming(true)}
                merging={merging}
                disabled={conflicting}
              />
            )}
          </>
        }
      />
      {actionError && (
        <Banner tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      )}
      {error && <Banner tone="warning">{error}</Banner>}

      <PullRequestTabs<Tab>
        tabs={[
          { id: "conversation", label: "Conversation" },
          {
            id: "checks",
            label: summary
              ? `Checks (${summary.passed}/${summary.total})`
              : "Checks",
          },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "conversation" ? (
        <>
          <GridScreen.Section title="Description">
            <Card>
              {detail.body.trim() ? (
                <Markdown text={detail.body} />
              ) : (
                <PullRequestEmptyLine>No description.</PullRequestEmptyLine>
              )}
            </Card>
          </GridScreen.Section>
          <GridScreen.Section title="Conversation" count={detail.comments.length}>
            <PullRequestTimeline
              entries={detail.comments.map((c) => ({
                id: c.id,
                author: c.author,
                review:
                  c.kind === "review" ? reviewStateLabel(c.review_state) : null,
                age: relativeTime(c.created_at),
                body: c.body.trim() ? <Markdown text={c.body} /> : null,
              }))}
            />
          </GridScreen.Section>
          {summary && (
            <PullRequestChecksSummary
              checks={checks}
              summary={summary}
              onOpenDetails={() => setTab("checks")}
            />
          )}
          {hasControl && open && (
            <GridScreen.Section title="Add a comment">
              <PullRequestCommentBox
                onSubmit={(body) =>
                  usePullRequestsStore.getState().comment(slug, number, body)
                }
              />
            </GridScreen.Section>
          )}
        </>
      ) : (
        <GridScreen.Section title="Checks" count={checks.length}>
          <PullRequestCheckList checks={checks} />
        </GridScreen.Section>
      )}

      {confirming && (
        <ConfirmDialog
          title="Merge this pull request?"
          titleId="aw-pr-merge"
          confirmLabel={prMergeStrategyLabel(strategy)}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setConfirming(false);
            setMerging(true);
            setActionError(null);
            try {
              await usePullRequestsStore
                .getState()
                .merge(slug, number, strategy);
            } catch (err) {
              setActionError(describeError(err));
            } finally {
              setMerging(false);
            }
          }}
        >
          {prMergeStrategyLabel(strategy)} on GitHub. This can&apos;t be undone
          from here.
          {summary && summary.tone !== "success" && " Checks aren't green yet."}
        </ConfirmDialog>
      )}
    </GridScreen>
  );
}
