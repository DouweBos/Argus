/**
 * `/sessions/:id/git/branches/:name`: one branch — where it stands, what you
 * can do with it, and its history. Without control it reads only.
 */

import type { RemoteCommit } from "@argus/remote-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  branchRef,
  branchTrackingLabel,
  currentBranchName,
  describeError,
  relativeTime,
} from "@argus/client-core";
import {
  Badge,
  Banner,
  Button,
  Card,
  CommitRow,
  ContextMenu,
  type ContextMenuItem,
  EmptyState,
  Icons,
  SidebarSection,
  Spinner,
} from "@argus/peacock";
import { appNavigate, navigateBack } from "../../routing/router";
import { branchLog, useBranchesStore } from "../../stores/branches";
import { useConnectionStore } from "../../stores/connection";
import { useHeldSession } from "../start/useHeldSession";
import { useBranchActions } from "./useBranchActions";

const EMPTY: never[] = [];

export function BranchScreen({
  refName,
  sessionId,
}: {
  refName: string;
  sessionId: string;
}) {
  const ready = useConnectionStore((s) => s.connection === "ready");
  const hasControl = useConnectionStore((s) => s.hasControl());
  const session = useHeldSession(sessionId);
  const branches = useBranchesStore((s) => s.bySession[sessionId] ?? EMPTY);
  const loaded = useBranchesStore(
    (s) => s.loadBySession[sessionId]?.loaded ?? false,
  );
  const branch = branches.find((b) => branchRef(b) === refName);
  const current = currentBranchName(branches);
  const [commits, setCommits] = useState<RemoteCommit[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    items: ContextMenuItem[];
    x: number;
    y: number;
  } | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  const canAct = hasControl && session?.kind === "project_root";
  const actions = useBranchActions({
    sessionId,
    branches,
    canAct,
    onDeleted: () => navigateBack(),
    onRenamed: (_, name) =>
      appNavigate({ name: "branch", sessionId, ref: name }, { replace: true }),
  });

  const reload = useCallback(() => {
    void useBranchesStore.getState().refresh(sessionId, { background: true });
    branchLog(sessionId, refName)
      .then((list) => {
        setCommits(list);
        setHistoryError(null);
      })
      .catch((err: unknown) => setHistoryError(describeError(err)));
  }, [sessionId, refName]);

  useEffect(() => {
    if (ready) {
      reload();
    }
  }, [ready, reload, actions.note]);

  if (!branch) {
    return loaded ? (
      <EmptyState
        icon={<Icons.BranchIcon size={22} />}
        title="Branch not found"
        body={`${refName} isn't in this repository any more.`}
      />
    ) : (
      <div className="aw-center">
        <Spinner />
        <span className="aw-muted">Reading the branch…</span>
      </div>
    );
  }

  const tracking = branchTrackingLabel(branch);
  const isLocal = branch.scope === "local";

  return (
    <div className="aw-ship">
      <Card stack>
        <div className="aw-ship-row">
          <span className="aw-ship-mono">{branch.name}</span>
          {branch.pinned && <Badge tone="neutral">pinned</Badge>}
          {branch.is_current && <Badge tone="accent">current</Badge>}
          {!isLocal && <Badge tone="neutral">{branch.remote ?? "remote"}</Badge>}
        </div>
        {tracking && <span className="aw-muted">{tracking}</span>}
        {(branch.ahead > 0 || branch.behind > 0) && (
          <span className="aw-muted">
            {branch.ahead} ahead · {branch.behind} behind its upstream
          </span>
        )}
      </Card>

      {canAct && (
        <div className="aw-ship-actions">
          {!branch.is_current && (
            <Button
              size="sm"
              variant="primary"
              leading={<Icons.BranchIcon size={12} />}
              disabled={actions.busy}
              onClick={() => actions.run(branch, { kind: "checkout" })}
            >
              {isLocal ? "Switch to" : "Check out locally"}
            </Button>
          )}
          {isLocal && (
            <Button
              size="sm"
              variant="secondary"
              leading={<Icons.PushIcon size={12} />}
              disabled={actions.busy}
              onClick={() => actions.run(branch, { kind: "push" })}
            >
              {branch.upstream ? "Push" : "Publish"}
            </Button>
          )}
          <span ref={moreRef}>
            <Button
              size="sm"
              variant="secondary"
              leading={<Icons.EllipsisIcon size={12} />}
              disabled={actions.busy}
              onClick={() => {
                const rect = moreRef.current?.getBoundingClientRect();
                if (rect) {
                  setMenu({
                    x: rect.left,
                    y: rect.bottom + 4,
                    items: actions.menuItems(branch),
                  });
                }
              }}
            >
              More
            </Button>
          </span>
        </div>
      )}

      {actions.note && (
        <Banner
          tone={actions.note.error ? "error" : "success"}
          onDismiss={actions.clearNote}
        >
          {actions.note.text}
        </Banner>
      )}

      {current && current !== branch.name && (
        <Card
          hoverable
          role="button"
          tabIndex={0}
          className="aw-ship-link"
          onClick={() =>
            appNavigate({
              name: "compare",
              sessionId,
              left: current,
              right: branchRef(branch),
            })
          }
        >
          <span>Compare with {current}</span>
          <Icons.ChevronRightIcon size={12} />
        </Card>
      )}

      <SidebarSection count={commits?.length}>History</SidebarSection>
      {historyError && <Banner tone="warning">{historyError}</Banner>}
      {commits === null && !historyError ? (
        <div className="aw-center">
          <Spinner />
          <span className="aw-muted">Reading history…</span>
        </div>
      ) : (
        <div className="aw-ship-list">
          {commits?.length === 0 && <span className="aw-muted">No commits.</span>}
          {commits?.map((c) => (
            <CommitRow
              key={c.hash}
              subject={c.subject}
              hash={c.hash}
              author={c.author}
              age={relativeTime(c.date)}
              onClick={() =>
                appNavigate({ name: "commit", sessionId, hash: c.hash })
              }
            />
          ))}
        </div>
      )}

      {menu && (
        <ContextMenu
          position={menu}
          items={menu.items}
          triggerRef={moreRef}
          onClose={() => setMenu(null)}
        />
      )}
      {actions.prompts}
    </div>
  );
}
