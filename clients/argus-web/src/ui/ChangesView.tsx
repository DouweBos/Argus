/**
 * Read-only changes review for a session — git status summary plus the diff of
 * what the agent changed, rendered with Peacock's diff primitives. A toggle
 * switches between the branch diff (everything vs the base branch) and the
 * working diff (uncommitted vs HEAD); with control, the land-work card below.
 */

import type { RemoteSession } from "@argus/remote-protocol";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  Button,
  CrossProjectRepoList,
  type CrossProjectRepoItem,
  EmptyState,
  FileDiffCard,
  Icons,
  parseDiff,
  SegmentedControl,
  Spinner,
  StatusDot,
} from "@argus/peacock";
import { appNavigate } from "../routing/router";
import type { DiffMode as Mode } from "../routing/screens";
import { useConnectionStore } from "../stores/connection";
import { useGitStore } from "../stores/git";
import { useProjectsStore } from "../stores/projects";
import { ViewFileButton } from "./FileDiffView";

const LandWork = lazy(() =>
  import("./ship/LandWork").then((m) => ({ default: m.LandWork })),
);

const MODE_OPTIONS = [
  { value: "branch" as const, label: "Vs base branch" },
  { value: "working" as const, label: "Uncommitted" },
];

/** Open one file's diff on its own, or the file itself. */
function ChangedFileActions({
  deleted,
  mode,
  path,
  sessionId,
}: {
  deleted: boolean;
  mode: Mode;
  path: string;
  sessionId: string;
}) {
  const hasControl = useConnectionStore((s) => s.hasControl());

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => appNavigate({ name: "fileDiff", sessionId, mode, path })}
      >
        Open
      </Button>
      {hasControl && !deleted && (
        <ViewFileButton sessionId={sessionId} path={path} />
      )}
    </>
  );
}

type Sessions = Record<string, RemoteSession[]>;

function findSession(byRepo: Sessions, id: string): RemoteSession | undefined {
  for (const list of Object.values(byRepo)) {
    const found = list.find((s) => s.id === id);
    if (found) {
      return found;
    }
  }

  return undefined;
}

/** Setup first, then where its pull request stands. */
function repoState(session: RemoteSession | undefined) {
  if (!session) {
    return { label: "Loading", tone: "neutral" as const };
  }
  if (session.status === "initializing") {
    return { label: "Setting up", tone: "neutral" as const };
  }
  if (session.status === "error") {
    return { label: "Setup failed", tone: "error" as const };
  }
  const pr = session.pull_request;
  if (!pr) {
    return null;
  }
  if (pr.state === "merged") {
    return { label: "Merged", tone: "success" as const };
  }
  if (pr.state === "closed") {
    return { label: "Closed", tone: "neutral" as const };
  }

  return {
    label: `${pr.state === "draft" ? "Draft" : "PR"} #${pr.number}`,
    tone: pr.state === "draft" ? ("neutral" as const) : ("accent" as const),
  };
}

/** Every repository of the session's cross-project session, its own first; empty for a single-repo one. */
function crossProjectRepos(
  byRepo: Sessions,
  sessionId: string,
): CrossProjectRepoItem[] {
  const session = findSession(byRepo, sessionId);
  const primary = session?.cross_project_of
    ? findSession(byRepo, session.cross_project_of)
    : session;
  if (!primary?.linked_repos?.length) {
    return [];
  }
  const name = (root: string) => root.split("/").filter(Boolean).pop() ?? root;

  return [
    {
      sessionId: primary.id,
      repoRoot: primary.repo_root,
      name: name(primary.repo_root),
      branch: primary.branch,
      state: repoState(primary),
    },
    ...primary.linked_repos.map((r) => ({
      sessionId: r.session_id,
      repoRoot: r.repo_root,
      name: name(r.repo_root),
      branch: r.branch,
      state: repoState(findSession(byRepo, r.session_id)),
    })),
  ];
}

/** `mode` is the route's: `/git/branch` or `/git/working`. */
export function ChangesView({
  mode,
  onModeChange,
  sessionId,
}: {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  sessionId: string;
}) {
  const connection = useConnectionStore((s) => s.connection);
  const hasControl = useConnectionStore((s) => s.hasControl());
  const status = useGitStore((s) => s.gitStatusBySession[sessionId]);
  const loadGitStatus = useGitStore((s) => s.loadGitStatus);
  const loadDiff = useGitStore((s) => s.loadDiff);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sessionsByRepo = useProjectsStore((s) => s.sessionsByRepo);
  const repos = crossProjectRepos(sessionsByRepo, sessionId);

  const refresh = useCallback(() => {
    loadGitStatus(sessionId).catch(() => {});
    loadDiff(sessionId, mode)
      .then((r) => setDiff(r.diff))
      .catch(() => setDiff(""))
      .finally(() => setLoading(false));
  }, [sessionId, mode, loadGitStatus, loadDiff]);

  useEffect(() => {
    if (connection !== "ready") {
      return;
    }
    setLoading(true);
    refresh();
    const poll = setInterval(refresh, 5000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [connection, refresh]);

  const files = diff ? parseDiff(diff) : [];

  return (
    <div className="aw-changes">
      <div className="aw-changes-bar">
        <SegmentedControl<Mode>
          aria-label="Diff mode"
          value={mode}
          options={MODE_OPTIONS}
          onChange={onModeChange}
        />
      </div>

      {repos.length > 0 && (
        <CrossProjectRepoList
          repos={repos}
          currentSessionId={sessionId}
          onSelect={(repo) =>
            appNavigate({ name: "changes", sessionId: repo.sessionId, mode })
          }
        />
      )}

      {status && (
        <div className="aw-changes-status">
          <StatusDot
            tone={status.conflict_count > 0 ? "warning" : "accent"}
            label={status.branch}
          />
          <span className="aw-muted">
            {status.ahead > 0 && `↑${status.ahead} `}
            {status.behind > 0 && `↓${status.behind} `}
            {status.dirty_count > 0
              ? `${status.dirty_count} changed`
              : "clean"}
            {status.conflict_count > 0 &&
              ` · ${status.conflict_count} conflicts`}
          </span>
        </div>
      )}

      {loading && diff === null ? (
        <div className="aw-center">
          <Spinner />
          <span className="aw-muted">Loading changes</span>
        </div>
      ) : files.length === 0 ? (
        <EmptyState
          icon={<Icons.BranchIcon size={22} />}
          title="No changes"
          body={
            mode === "branch"
              ? "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
              : "No uncommitted changes in the working tree."
          }
        />
      ) : (
        <div className="aw-changes-files">
          {files.map((f) => (
            <FileDiffCard
              key={f.newPath || f.oldPath}
              file={f}
              headerActions={
                <ChangedFileActions
                  sessionId={sessionId}
                  mode={mode}
                  path={f.newPath || f.oldPath}
                  deleted={f.status === "D"}
                />
              }
            />
          ))}
        </div>
      )}

      {hasControl && (
        <Suspense fallback={null}>
          <LandWork sessionId={sessionId} files={files} onChanged={refresh} />
        </Suspense>
      )}
    </div>
  );
}
