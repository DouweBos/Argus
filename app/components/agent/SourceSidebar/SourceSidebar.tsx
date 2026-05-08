import type { GitViewScope, SourceView } from "../GitView";
import { useCallback, useEffect, useState } from "react";
import {
  Icons,
  SidebarItem,
  SidebarNav,
  SidebarSection,
  useDropTarget,
} from "@argus/peacock";
import { useIpcEvent } from "../../../hooks/useIpcEvent";
import { useSessionSync } from "../../../hooks/useSessionSync";
import {
  gitListArchivedBranches,
  gitListLocalBranches,
  gitListPinnedBranches,
  gitListRemoteBranches,
  gitListTags,
  gitStashSave,
  gitSubmoduleList,
  gitWorktreeList,
  readArgusConfig,
  type EnrichedBranch,
  type GitSubmodule,
  type GitTag,
  type GitWorktree,
  type RemoteBranch,
} from "../../../lib/ipc";
import { useRouteGitRefName, useRouteGitView } from "../../../lib/routeHooks";
import {
  GIT_STATUS_CHANGED_EVENT,
  type GitStatusChangedPayload,
} from "../../../lib/types";
import { pushError } from "../../../stores/notificationsStore";
import {
  setGitSidebarCollapsed,
  useGitSidebarCollapsed,
} from "../../../stores/settingsStore";
import { CreatePullRequestDialog } from "../../pullRequests/CreatePullRequestDialog";
import {
  ArchivedBranchesSection,
  BranchesSection,
  PinnedBranchesSection,
  RemotesSection,
  SubmodulesSection,
  TagsSection,
  WorktreesSection,
} from "./SidebarRefSection";
import styles from "./SourceSidebar.module.css";
import { StashFromDropDialog } from "./StashFromDropDialog";

interface SourceSidebarProps {
  conflictCount?: number;
  /** Default branch name (`main`/`master`) used to pin a row at the top. */
  defaultBranch?: string | null;
  fileCount: number;
  onViewChange: (view: SourceView) => void;
  /** Project root path — required for archived-branch + PR lookups. */
  repoRoot: string;
  /** Drives whether project-scope entries render. */
  scope?: GitViewScope;
  sessionId: string;
  /** Render the Conflicts entry. Only shown when an op is in progress. */
  showConflicts?: boolean;
  stashCount?: number;
}

export function SourceSidebar({
  onViewChange,
  fileCount,
  stashCount,
  conflictCount,
  showConflicts,
  scope = "session",
  sessionId,
  repoRoot,
  defaultBranch,
}: SourceSidebarProps) {
  const collapsed = useGitSidebarCollapsed();
  const isProject = scope === "project";

  // Session-scope only: surface ahead/behind vs the session branch's effective
  // upstream (own upstream when set, otherwise `origin/<baseBranch>`). Project
  // scope already shows per-branch sync state in the Branches section.
  const sessionSync = useSessionSync(
    isProject ? "" : sessionId,
    isProject ? null : defaultBranch,
  );
  const branchCount =
    !isProject && (sessionSync.ahead > 0 || sessionSync.behind > 0) ? (
      <span
        className={styles.aheadBehind}
        title={
          sessionSync.upstreamRef
            ? `${sessionSync.ahead} ahead, ${sessionSync.behind} behind ${sessionSync.upstreamRef}`
            : `${sessionSync.ahead} ahead, ${sessionSync.behind} behind upstream`
        }
      >
        {sessionSync.ahead > 0 && (
          <span>
            <span className={styles.arrow}>↑</span>
            {sessionSync.ahead}
          </span>
        )}
        {sessionSync.behind > 0 && (
          <span>
            <span className={styles.arrow}>↓</span>
            {sessionSync.behind}
          </span>
        )}
      </span>
    ) : undefined;

  // Top-nav highlights are driven purely by the URL: a button is active iff
  // its target gitView matches the current route's gitView. Ref-scoped routes
  // (`/git/branches/:name`, `/git/tags/:name`) deliberately don't match any
  // top-nav button — the matching branch/tag row in a section below carries
  // the selection instead, so only one item is ever highlighted at a time.
  const routeGitView = useRouteGitView();
  const routeGitRefName = useRouteGitRefName();
  // `/sessions/:id/git` (no sub-path) defaults to working-copy.
  const effectiveGitView = routeGitView ?? "working";
  const navActive = (target: string): boolean =>
    effectiveGitView === target && !routeGitRefName;

  // Dialog for creating a PR when a branch is dropped onto the PR nav item.
  const [prDialogHead, setPrDialogHead] = useState<string | null>(null);

  // Pending stash creation triggered by dropping files onto the Stashes nav.
  const [stashDropPaths, setStashDropPaths] = useState<string[] | null>(null);

  // Drop target on the "Pull Requests" sidebar item.
  const {
    isOver: prDropIsOver,
    onDragEnter: onPrDragEnter,
    onDragLeave: onPrDragLeave,
    onDragOver: onPrDragOver,
    onDrop: onPrDrop,
  } = useDropTarget<{ branchName: string; isCurrent: boolean; kind: "branch" }>(
    {
      accepts: ["branch"],
      label: "Open PR for …",
      onDrop: (payload) => {
        setPrDialogHead(payload.branchName);
      },
    },
  );

  // Drop target on the "Stashes" sidebar item — drop file rows onto it to
  // stash just those paths (partial stash via DnD).
  const {
    isOver: stashDropIsOver,
    onDragEnter: onStashDragEnter,
    onDragLeave: onStashDragLeave,
    onDragOver: onStashDragOver,
    onDrop: onStashDrop,
  } = useDropTarget<{ kind: "file"; paths: string[] }>({
    accepts: ["file"],
    label: (payload) =>
      payload.paths.length === 1
        ? `Stash 1 file`
        : `Stash ${payload.paths.length} files`,
    onDrop: (payload) => {
      if (payload.paths.length > 0) {
        setStashDropPaths(payload.paths);
      }
    },
  });

  // Project-scope domain data
  const [branches, setBranches] = useState<EnrichedBranch[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranch[]>([]);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [submodules, setSubmodules] = useState<GitSubmodule[]>([]);
  const [archivedBranches, setArchivedBranches] = useState<string[]>([]);
  const [pinnedBranches, setPinnedBranches] = useState<string[]>([]);
  // Branch names from `.argus.json`'s `protected_branches`. Surfaced to the
  // Branches/Tags trees so trunk-style branches the team has marked as
  // protected float to the top alongside built-in defaults like `main`.
  const [protectedBranches, setProtectedBranches] = useState<string[]>([]);

  const refreshProjectData = useCallback(async () => {
    if (!isProject) {
      return;
    }
    try {
      const [lb, rb, tg, wt, sm, ar, pn] = await Promise.all([
        gitListLocalBranches(sessionId),
        gitListRemoteBranches(sessionId),
        gitListTags(sessionId),
        gitWorktreeList(sessionId),
        gitSubmoduleList(sessionId),
        gitListArchivedBranches(repoRoot),
        gitListPinnedBranches(repoRoot),
      ]);
      setBranches(lb);
      setRemoteBranches(rb);
      setTags(tg);
      setWorktrees(wt);
      setSubmodules(sm);
      setArchivedBranches(ar);
      setPinnedBranches(pn);
    } catch {
      // Best-effort — individual section errors silently leave lists empty.
    }
  }, [isProject, sessionId, repoRoot]);

  useEffect(() => {
    if (!isProject) {
      return;
    }
    readArgusConfig(repoRoot)
      .then((cfg) => setProtectedBranches(cfg.protected_branches ?? []))
      .catch(() => setProtectedBranches([]));
  }, [isProject, repoRoot]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect --
       Initial data load on mount; refreshProjectData wraps async state. */
    refreshProjectData().catch(() => undefined);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [refreshProjectData]);

  // Refresh ahead/behind counts and branch list whenever git state changes
  // (commit, checkout, fetch, etc.) for this session's worktree.
  useIpcEvent<GitStatusChangedPayload>(GIT_STATUS_CHANGED_EVENT, (payload) => {
    if (isProject && payload.sessionId === sessionId) {
      refreshProjectData().catch(() => undefined);
    }
  });

  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Expand git sidebar"
        title="Expand git sidebar (Cmd+\\)"
        className={styles.collapsedRail}
        onClick={() => setGitSidebarCollapsed(false)}
      >
        <span className={styles.collapsedHandle}>
          <Icons.ChevronRightIcon size={10} />
        </span>
      </button>
    );
  }

  return (
    <>
      <SidebarNav framed className={styles.sidebar}>
        <div className={styles.scroll}>
          {/* ── Workspace section ───────────────────────────────── */}
          <SidebarSection>{isProject ? "Workspace" : "Session"}</SidebarSection>
          <SidebarItem
            active={navActive("working")}
            count={fileCount > 0 ? fileCount : undefined}
            leading={<Icons.WorkingCopyIcon size={13} />}
            onClick={() => onViewChange("working-copy")}
          >
            Working Copy
          </SidebarItem>
          {!isProject && (
            <SidebarItem
              active={navActive("branch")}
              count={branchCount}
              leading={<Icons.BranchIcon size={13} />}
              onClick={() => onViewChange("branch")}
            >
              Branch
            </SidebarItem>
          )}
          {isProject && (
            <SidebarItem
              active={navActive("history")}
              leading={<Icons.ClockIcon size={13} />}
              onClick={() => onViewChange("history")}
            >
              History
            </SidebarItem>
          )}
          <SidebarItem
            active={navActive("stashes")}
            count={stashCount && stashCount > 0 ? stashCount : undefined}
            leading={<Icons.StashIcon size={13} />}
            onClick={() => onViewChange("stashes")}
            onDragEnter={onStashDragEnter}
            onDragOver={onStashDragOver}
            onDragLeave={onStashDragLeave}
            onDrop={onStashDrop}
            className={stashDropIsOver ? styles.navItemOver : undefined}
          >
            Stashes
          </SidebarItem>
          {isProject && (
            <SidebarItem
              active={navActive("pull-requests")}
              leading={<Icons.MergeIcon size={13} />}
              onClick={() => onViewChange("pull-requests")}
              onDragEnter={onPrDragEnter}
              onDragOver={onPrDragOver}
              onDragLeave={onPrDragLeave}
              onDrop={onPrDrop}
              className={prDropIsOver ? styles.navItemOver : undefined}
            >
              Pull Requests
            </SidebarItem>
          )}
          {isProject && (
            <SidebarItem
              active={navActive("branches-review")}
              leading={<Icons.ReviewQueueIcon size={13} />}
              onClick={() => onViewChange("branches-review")}
            >
              Branches Review
            </SidebarItem>
          )}
          <SidebarItem
            active={navActive("reflog")}
            leading={<Icons.HistoryIcon size={13} />}
            onClick={() => onViewChange("reflog")}
          >
            Reflog
          </SidebarItem>
          {isProject && (
            <SidebarItem
              active={navActive("settings")}
              leading={<Icons.GearIcon size={13} />}
              onClick={() => onViewChange("settings")}
            >
              Settings
            </SidebarItem>
          )}
          {showConflicts && (
            <SidebarItem
              active={navActive("conflicts")}
              count={
                conflictCount && conflictCount > 0 ? conflictCount : undefined
              }
              leading={<Icons.WarningIcon size={13} />}
              onClick={() => onViewChange("conflicts")}
            >
              Conflicts
            </SidebarItem>
          )}

          {/* ── Project-scope domain sections ───────────────────── */}
          {isProject && (
            <>
              <PinnedBranchesSection
                branches={branches}
                pinnedBranches={pinnedBranches}
                onPinnedChange={setPinnedBranches}
                sessionId={sessionId}
                repoRoot={repoRoot}
                onViewChange={onViewChange}
              />
              <BranchesSection
                branches={branches}
                defaultBranch={defaultBranch}
                archivedBranches={archivedBranches}
                onArchivedChange={setArchivedBranches}
                pinnedBranches={pinnedBranches}
                onPinnedChange={setPinnedBranches}
                priorityBranchNames={protectedBranches}
                sessionId={sessionId}
                repoRoot={repoRoot}
                onViewChange={onViewChange}
              />
              <ArchivedBranchesSection
                branches={branches}
                archivedBranches={archivedBranches}
                onArchivedChange={setArchivedBranches}
                sessionId={sessionId}
                repoRoot={repoRoot}
                onViewChange={onViewChange}
              />
              <TagsSection
                tags={tags}
                priorityTagNames={protectedBranches}
                sessionId={sessionId}
                repoRoot={repoRoot}
                onViewChange={onViewChange}
              />
              <RemotesSection
                remoteBranches={remoteBranches}
                sessionId={sessionId}
                repoRoot={repoRoot}
                onViewChange={onViewChange}
              />
              {submodules.length > 0 && (
                <SubmodulesSection
                  submodules={submodules}
                  sessionId={sessionId}
                  repoRoot={repoRoot}
                  onViewChange={onViewChange}
                />
              )}
              <WorktreesSection worktrees={worktrees} />
            </>
          )}
        </div>
      </SidebarNav>
      {prDialogHead && (
        <CreatePullRequestDialog
          headBranch={prDialogHead}
          baseBranch={defaultBranch ?? null}
          repoRoot={repoRoot}
          sessionId={sessionId}
          onClose={() => setPrDialogHead(null)}
        />
      )}
      {stashDropPaths && (
        <StashFromDropDialog
          paths={stashDropPaths}
          onCancel={() => setStashDropPaths(null)}
          onConfirm={(message) => {
            const paths = stashDropPaths;
            setStashDropPaths(null);
            gitStashSave(sessionId, { paths, message }).catch((err: unknown) =>
              pushError(
                err instanceof Error ? err.message : String(err),
                "Stash files",
              ),
            );
          }}
        />
      )}
    </>
  );
}
