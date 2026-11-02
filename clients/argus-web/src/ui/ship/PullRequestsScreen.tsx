/**
 * `/pull-requests`: every PR the computer's `gh` thinks is yours to look at,
 * bucketed as the Mac does — what needs you first, the quiet ones after.
 */

import type { RemotePullRequest } from "@argus/remote-protocol";
import { useCallback } from "react";
import {
  ATTENTION_BUCKETS,
  BUCKET_LABEL,
  groupByBucket,
  loadPhase,
  reasonLabel,
  reasonTone,
  relativeTime,
  remotePullRequestSignals,
  reviewDecisionLabel,
} from "@argus/client-core";
import {
  Banner,
  Button,
  EmptyState,
  GridScreen,
  Icons,
  PullRequestBuckets,
  PullRequestRow,
  type PullRequestRowModel,
  Spinner,
} from "@argus/peacock";
import { appNavigate } from "../../routing/router";
import { useConnectionStore } from "../../stores/connection";
import { usePullRequestsStore } from "../../stores/pullRequests";
import { useLiveRefresh } from "../useLiveRefresh";

function rowModel(pr: RemotePullRequest): PullRequestRowModel {
  return {
    title: pr.title,
    repo: pr.repo,
    number: pr.number,
    author: pr.author,
    isDraft: pr.is_draft,
    updated: relativeTime(pr.updated_at),
    headRef: pr.head_ref,
    reasons: pr.reasons.map((r) => ({
      label: reasonLabel(r),
      tone: reasonTone(r),
    })),
    review: reviewDecisionLabel(pr.review_decision),
  };
}

export function openPullRequest(pr: Pick<RemotePullRequest, "number" | "repo">) {
  const [owner, repo] = pr.repo.split("/");
  if (owner && repo) {
    appNavigate({ name: "pullRequest", owner, repo, number: pr.number });
  }
}

export function PullRequestsScreen() {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const pullRequests = usePullRequestsStore((s) => s.pullRequests);
  const load = usePullRequestsStore((s) => s.load);
  const refresh = useCallback(() => {
    void usePullRequestsStore.getState().refresh({ background: true });
  }, []);
  useLiveRefresh(ready, refresh, 30_000);

  const phase = loadPhase(load, pullRequests.length === 0);
  if (phase.kind === "loading") {
    return (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Asking GitHub…</span>
      </div>
    );
  }
  if (phase.kind === "failed") {
    return (
      <EmptyState
        icon={<Icons.WarningIcon size={22} />}
        title="Couldn't fetch pull requests"
        body={phase.error}
        action={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void usePullRequestsStore.getState().refresh()}
          >
            Retry
          </Button>
        }
      />
    );
  }
  if (phase.kind === "empty") {
    return (
      <EmptyState
        icon={<Icons.PullRequestIcon size={22} />}
        title="No pull requests"
        body="Nothing open that's yours to review or land."
      />
    );
  }

  return (
    <GridScreen plain className="aw-ship-grid">
      {load.error && <Banner tone="warning">{load.error}</Banner>}
      <PullRequestBuckets
        buckets={groupByBucket(pullRequests, remotePullRequestSignals).map(
          (group) => ({
            id: group.bucket,
            title: BUCKET_LABEL[group.bucket],
            attention: ATTENTION_BUCKETS.has(group.bucket),
            rows: group.prs.map((pr) => (
              <PullRequestRow
                key={pr.url}
                pr={rowModel(pr)}
                onOpen={() => openPullRequest(pr)}
                actions={
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Open on GitHub"
                    aria-label="Open on GitHub"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(pr.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <Icons.WebIcon size={14} />
                  </Button>
                }
              />
            )),
          }),
        )}
      />
    </GridScreen>
  );
}
