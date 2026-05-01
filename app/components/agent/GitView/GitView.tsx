import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  BranchDialog,
  Button,
  DestructiveConfirm,
  GitErrorBanner,
  Input,
  PullDialog,
  PushDialog,
  ShortcutCheatsheet,
  TagDialog,
  type BranchDialogResult,
  type GitErrorKind,
  type PullDialogResult,
  type PushDialogResult,
  type TagDialogConfirm,
} from "@argus/peacock";
import { useGitObservation } from "../../../hooks/useGitObservation";
import { GitError } from "../../../lib/gitError";
import {
  gitCreateBranch,
  gitCreateTag,
  gitListLocalBranches,
  gitListRemotes,
  gitPullV2,
  gitPushV2,
  pushSessionBranch,
  renameSessionBranch,
  type EnrichedBranch,
  type GitRemoteRich,
} from "../../../lib/ipc";
import { useRouteGitRefName, useRouteGitView } from "../../../lib/routeHooks";
import { setGitView } from "../../../stores/editorStore";
import {
  EMPTY_HISTORY_FILTERS,
  requestFocusCommit,
  setHistoryFilters,
  useHistoryFilters,
} from "../../../stores/gitUiStore";
import { useDefaultPullStrategy } from "../../../stores/settingsStore";
import {
  setGitSidebarWidth,
  toggleGitSidebarCollapsed,
  useGitSidebarCollapsed,
  useGitSidebarWidth,
} from "../../../stores/settingsStore";
import { ResizablePanel } from "../../layout/ResizablePanel";
import { Dialog, dialogStyles } from "../../shared/Dialog";
import { BranchView } from "../BranchView";
import { ChangesToolbar } from "../ChangesToolbar";
import { DiffViewer } from "../DiffViewer";
import { HistoryView } from "../HistoryView";
import { SourceSidebar } from "../SourceSidebar";
import { StashesView } from "../StashesView";
import { BisectView } from "./BisectView";
import { BlameView } from "./BlameView/BlameView";
import { BranchesReviewView } from "./BranchesReviewView";
import { CompareView } from "./CompareView/CompareView";
import { ConflictsView } from "./ConflictsView";
import styles from "./GitView.module.css";
import { HooksView } from "./HooksView";
import { InteractiveRebaseView } from "./InteractiveRebaseView/InteractiveRebaseView";
import { QuickActions } from "./JumpToRef";
import { ProjectGitSettingsView } from "./ProjectGitSettingsView";
import { ProjectPullRequestsView } from "./ProjectPullRequestsView";
import { ReflogView } from "./ReflogView";
import { SubmodulesView } from "./SubmodulesView";
import { GIT_SHORTCUTS } from "./shortcuts";
import { useGitShortcuts } from "./useGitShortcuts";

export type SourceView =
  | "bisect"
  | "blame"
  | "branch"
  | "branches-review"
  | "compare"
  | "conflicts"
  | "history"
  | "hooks"
  | "interactive-rebase"
  | "pull-requests"
  | "reflog"
  | "settings"
  | "stashes"
  | "submodules"
  | "working-copy";

export type GitViewScope = "project" | "session";

interface GitViewProps {
  baseBranch?: string | null;
  branchName?: string;
  repoRoot: string;
  /** Determines which destructive ops and project-scope views are exposed. */
  scope?: GitViewScope;
  sessionId: string;
}

interface BannerState {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
}

function urlToView(v: string | null): SourceView {
  if (v === "working") {
    return "working-copy";
  }
  if (
    v === "bisect" ||
    v === "blame" ||
    v === "branch" ||
    v === "branches-review" ||
    v === "compare" ||
    v === "conflicts" ||
    v === "history" ||
    v === "hooks" ||
    v === "interactive-rebase" ||
    v === "pull-requests" ||
    v === "reflog" ||
    v === "settings" ||
    v === "stashes" ||
    v === "submodules"
  ) {
    return v;
  }

  return "working-copy";
}

function viewToUrl(v: SourceView): string {
  if (v === "working-copy") {
    return "working";
  }

  return v;
}

export function GitView({
  sessionId,
  baseBranch,
  branchName,
  repoRoot,
  scope = "session",
}: GitViewProps) {
  const urlGitView = useRouteGitView();
  const urlGitRefName = useRouteGitRefName();
  // Ref-scoped routes (`/git/branches/:name`, `/git/tags/:name`, and bare
  // `/git/branches`) all render the history view filtered to that ref. The
  // sidebar's branch/tag rows own the highlighted-state for these routes —
  // top-nav buttons stay deselected, satisfying the single-selection rule.
  const isRefRoute =
    urlGitView === "branches" ||
    (urlGitView === "tags" && urlGitRefName !== null);
  const activeView: SourceView = isRefRoute ? "history" : urlToView(urlGitView);

  // Keep the persisted history-filter state in sync with the URL ref so the
  // history view reads a consistent `branch` filter regardless of whether the
  // user clicked a sidebar row, used Back/Forward, or pasted a deep link.
  // Other history filters (author, query, since, until) live only in the
  // store and are intentionally not encoded in the URL.
  const persistedFilters = useHistoryFilters(sessionId);
  const expectedBranchFilter =
    (urlGitView === "branches" || urlGitView === "tags") && urlGitRefName
      ? urlGitRefName
      : "";
  useEffect(() => {
    if (persistedFilters.branch !== expectedBranchFilter) {
      setHistoryFilters(sessionId, {
        ...EMPTY_HISTORY_FILTERS,
        ...persistedFilters,
        branch: expectedBranchFilter,
      });
    }
  }, [sessionId, expectedBranchFilter, persistedFilters]);
  const location = useLocation();
  const compareParams = useMemo(() => {
    if (activeView !== "compare") {
      return { left: "", right: "" };
    }
    const sp = new URLSearchParams(location.search);

    return { left: sp.get("left") ?? "", right: sp.get("right") ?? "" };
  }, [activeView, location.search]);
  const interactiveRebaseFrom = useMemo(() => {
    if (activeView !== "interactive-rebase") {
      return "";
    }
    const sp = new URLSearchParams(location.search);

    return sp.get("from") ?? "";
  }, [activeView, location.search]);
  const setActiveView = (v: SourceView) => {
    setGitView(viewToUrl(v) as Parameters<typeof setGitView>[0]);
  };
  const [fileCount, setFileCount] = useState(0);
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  const [renameOpen, setRenameOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [tagDialogBranches, setTagDialogBranches] = useState<EnrichedBranch[]>(
    [],
  );
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [newBranchStartPoint, setNewBranchStartPoint] = useState<string | null>(
    null,
  );
  const [forceConfirmStage, setForceConfirmStage] = useState(false);
  const [remotes, setRemotes] = useState<GitRemoteRich[]>([]);
  /** Search query lifted from DiffViewer/ChangesToolbar so the unified toolbar can drive Working Copy file filtering. */
  const [searchQuery, setSearchQuery] = useState("");
  const defaultPullStrategy = useDefaultPullStrategy();

  const { status, refresh: refreshStatus } = useGitObservation(sessionId);

  // Reset file count + view when session changes so stale state doesn't linger.
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    setFileCount(0);
    setBanner(null);
    if (activeView === "conflicts") {
      setActiveView("working-copy");
    }
  }

  // Auto-leave the conflicts view if the op finishes elsewhere — done at
  // render-time to keep with React 19's "no setState in effect" guidance.
  if (activeView === "conflicts" && status && status.inProgress == null) {
    setActiveView("working-copy");
  }

  const openTagDialog = useCallback(() => {
    gitListLocalBranches(sessionId)
      .then(setTagDialogBranches)
      .catch(() => setTagDialogBranches([]));
    setTagDialogOpen(true);
  }, [sessionId]);

  // Cmd+1..6 sub-view switching.
  const handlers = useMemo(
    () => ({
      "view-working-copy": () => setActiveView("working-copy"),
      "view-branch": () => setActiveView("branch"),
      "view-history": () => setActiveView("history"),
      "view-stashes": () => setActiveView("stashes"),
      "view-reflog": () => setActiveView("reflog"),
      "view-pull-requests": () => {
        if (scope === "project") {
          setActiveView("pull-requests");
        }
      },
      "view-branches-review": () => {
        if (scope === "project") {
          setActiveView("branches-review");
        }
      },
      "view-conflicts": () => {
        if (status?.inProgress) {
          setActiveView("conflicts");
        }
      },
      "toggle-sidebar": () => toggleGitSidebarCollapsed(),
      "jump-to-ref": () => setJumpOpen(true),
      "quick-actions": () => setJumpOpen(true),
      cheatsheet: () => setCheatsheetOpen(true),
      "push-with-options": () => {
        if (scope === "project") {
          setForceConfirmStage(false);
          setPushDialogOpen(true);
        }
      },
      "pull-with-options": () => {
        if (scope === "project") {
          setPullDialogOpen(true);
        }
      },
      "new-tag": () => {
        if (scope === "project") {
          openTagDialog();
        }
      },
      "new-branch": () => {
        setNewBranchStartPoint(status?.branch ?? "HEAD");
      },
    }),
    [status, scope, openTagDialog],
  );
  useGitShortcuts(scope, handlers);

  // Load remotes for the push dialog when project-scope.
  useMemo(() => {
    if (scope !== "project") {
      return;
    }
    gitListRemotes(sessionId)
      .then(setRemotes)
      .catch(() => undefined);
  }, [scope, sessionId]);

  const runRemoteOp = useCallback(async (op: () => Promise<unknown>) => {
    setBanner(null);
    try {
      await op();
    } catch (err) {
      if (err instanceof GitError) {
        setBanner({
          kind: err.kind,
          message: err.message,
          recovery: err.recovery,
        });
      } else {
        setBanner({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, []);

  const onToolbarPullDialog = useCallback(() => {
    if (scope === "project") {
      setPullDialogOpen(true);
    }
  }, [scope]);
  const onToolbarPushDialog = useCallback(() => {
    if (scope === "project") {
      setForceConfirmStage(false);
      setPushDialogOpen(true);
    } else if (status && status.upstream == null) {
      setPublishConfirmOpen(true);
    }
  }, [scope, status]);
  const onToolbarRenameBranch = useCallback(() => setRenameOpen(true), []);
  const onToolbarTagSignal = useCallback(() => {
    openTagDialog();
  }, [openTagDialog]);
  const onToolbarRefresh = useCallback(() => {
    refreshStatus().catch(() => undefined);
  }, [refreshStatus]);

  const publishBranch = useCallback(async () => {
    setPublishConfirmOpen(false);
    setBanner(null);
    try {
      await pushSessionBranch(sessionId);
    } catch (err) {
      if (err instanceof GitError) {
        setBanner({
          kind: err.kind,
          message: err.message,
          recovery: err.recovery,
        });
      } else {
        setBanner({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [sessionId]);

  const sidebarCollapsed = useGitSidebarCollapsed();
  const sidebarWidth = useGitSidebarWidth();

  const sidebar = (
    <SourceSidebar
      fileCount={fileCount}
      stashCount={status?.stashCount}
      conflictCount={status?.conflictCount}
      showConflicts={Boolean(status?.inProgress)}
      scope={scope}
      sessionId={sessionId}
      repoRoot={repoRoot}
      defaultBranch={baseBranch}
      onViewChange={setActiveView}
    />
  );

  return (
    <div className={styles.container}>
      {sidebarCollapsed ? (
        sidebar
      ) : (
        <ResizablePanel
          defaultWidth={sidebarWidth}
          minWidth={0.08}
          maxWidth={0.4}
          side="left"
          onResize={setGitSidebarWidth}
        >
          {sidebar}
        </ResizablePanel>
      )}

      <div className={styles.main}>
        <ChangesToolbar
          activeView={activeView}
          scope={scope}
          sessionId={sessionId}
          repoRoot={repoRoot}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchSubmit={() => setJumpOpen(true)}
          onRefresh={onToolbarRefresh}
          onNavigate={setActiveView}
          onPullDialog={onToolbarPullDialog}
          onPushDialog={onToolbarPushDialog}
          onRenameBranch={onToolbarRenameBranch}
          onTagSignal={onToolbarTagSignal}
        />

        {banner && (
          <GitErrorBanner
            kind={banner.kind}
            message={banner.message}
            recovery={banner.recovery}
            onAction={(actionId) => {
              if (actionId === "retry" || actionId === "publish-branch") {
                publishBranch();

                return;
              }
              if (actionId === "copy-stderr") {
                navigator.clipboard
                  ?.writeText(banner.message)
                  .catch(() => undefined);

                return;
              }
              if (
                scope === "project" &&
                (actionId === "force-with-lease" ||
                  actionId === "force-with-lease-confirm")
              ) {
                setBanner(null);
                setForceConfirmStage(true);
                setPushDialogOpen(true);

                return;
              }
              if (scope === "project" && actionId === "pull-then-push") {
                setBanner(null);
                setPullDialogOpen(true);

                return;
              }
              // eslint-disable-next-line no-console
              console.warn(`[git] action "${actionId}" not wired`);
            }}
            onDismiss={() => setBanner(null)}
          />
        )}

        <div className={styles.viewArea}>
          {activeView === "working-copy" && (
            <DiffViewer
              baseBranch={baseBranch}
              branchName={branchName}
              repoRoot={repoRoot}
              sessionId={sessionId}
              searchQuery={searchQuery}
              onFileCountChange={setFileCount}
              onRenameBranch={onToolbarRenameBranch}
              onPublishBranch={() => setPublishConfirmOpen(true)}
            />
          )}

          {activeView === "branch" && <BranchView sessionId={sessionId} />}

          {activeView === "history" && (
            <HistoryView scope={scope} sessionId={sessionId} />
          )}

          {activeView === "stashes" && (
            <StashesView
              sessionId={sessionId}
              onRefresh={() => setActiveView("working-copy")}
            />
          )}

          {activeView === "reflog" && (
            <ReflogView scope={scope} sessionId={sessionId} />
          )}

          {activeView === "conflicts" && (
            <ConflictsView
              inProgress={status?.inProgress ?? null}
              sessionId={sessionId}
              baseBranch={baseBranch}
            />
          )}

          {activeView === "submodules" && scope === "project" && (
            <SubmodulesView sessionId={sessionId} />
          )}
          {activeView === "bisect" && scope === "project" && (
            <BisectView sessionId={sessionId} />
          )}
          {activeView === "hooks" && scope === "project" && (
            <HooksView sessionId={sessionId} />
          )}
          {activeView === "pull-requests" && scope === "project" && (
            <ProjectPullRequestsView repoRoot={repoRoot} />
          )}
          {activeView === "branches-review" && scope === "project" && (
            <BranchesReviewView
              sessionId={sessionId}
              repoRoot={repoRoot}
              defaultBranch={baseBranch}
            />
          )}
          {activeView === "compare" &&
            compareParams.left &&
            compareParams.right && (
              <CompareView
                sessionId={sessionId}
                repoRoot={repoRoot}
                left={compareParams.left}
                right={compareParams.right}
              />
            )}
          {activeView === "blame" && (
            <BlameView
              sessionId={sessionId}
              repoRoot={repoRoot}
              onShowHistory={() => {
                setActiveView("history");
              }}
              onRevealInHistory={() => {
                setActiveView("history");
              }}
            />
          )}
          {activeView === "interactive-rebase" && interactiveRebaseFrom && (
            <InteractiveRebaseView
              fromRef={interactiveRebaseFrom}
              sessionId={sessionId}
              onDone={() => setActiveView("history")}
            />
          )}
          {activeView === "settings" && scope === "project" && (
            <ProjectGitSettingsView repoRoot={repoRoot} />
          )}
        </div>
      </div>

      {renameOpen && status && (
        <RenameBranchDialog
          currentBranch={status.branch}
          sessionId={sessionId}
          onClose={() => setRenameOpen(false)}
          onError={(b) => setBanner(b)}
        />
      )}

      <ShortcutCheatsheet
        open={cheatsheetOpen}
        scope={scope}
        shortcuts={GIT_SHORTCUTS}
        onClose={() => setCheatsheetOpen(false)}
      />

      {jumpOpen && (
        <QuickActions
          repoRoot={repoRoot}
          sessionId={sessionId}
          onClose={() => setJumpOpen(false)}
          onNavigateView={(viewId) => {
            setActiveView(urlToView(viewId));
          }}
          onSelectBranch={() => {
            setActiveView("history");
          }}
          onSelectCommit={(hash) => {
            setActiveView("history");
            requestFocusCommit(hash);
          }}
        />
      )}

      {scope === "project" && pushDialogOpen && status && (
        <PushDialog
          open
          currentBranch={status.branch}
          remotes={remotes.map((r) => r.name)}
          hasUpstream={Boolean(status.upstream)}
          forceConfirmStage={forceConfirmStage}
          onCancel={() => setPushDialogOpen(false)}
          onConfirm={(r: PushDialogResult) => {
            setPushDialogOpen(false);
            setForceConfirmStage(false);
            runRemoteOp(() =>
              gitPushV2(sessionId, {
                remote: r.remote,
                branch: r.branch,
                forceWithLease: r.forceWithLease,
                setUpstream: r.setUpstream,
                tags: r.tags,
                ref: r.ref,
              }),
            );
          }}
        />
      )}

      {scope === "project" && pullDialogOpen && (
        <PullDialog
          open
          defaultStrategy={defaultPullStrategy}
          onCancel={() => setPullDialogOpen(false)}
          onConfirm={(r: PullDialogResult) => {
            setPullDialogOpen(false);
            runRemoteOp(() =>
              gitPullV2(sessionId, {
                strategy: r.strategy,
                prune: r.prune,
                tags: r.tags,
              }),
            );
          }}
        />
      )}

      {scope === "project" && tagDialogOpen && (
        <TagDialog
          open
          mode="create"
          refOptions={tagDialogBranches.map((b) => b.name)}
          onCancel={() => setTagDialogOpen(false)}
          onConfirm={(opts: TagDialogConfirm) => {
            setTagDialogOpen(false);
            runRemoteOp(() => gitCreateTag(sessionId, opts));
          }}
        />
      )}

      {newBranchStartPoint !== null && (
        <BranchDialog
          open
          currentBranch={status?.branch ?? "HEAD"}
          defaultStartPoint={newBranchStartPoint}
          onCancel={() => setNewBranchStartPoint(null)}
          onConfirm={(r: BranchDialogResult) => {
            setNewBranchStartPoint(null);
            runRemoteOp(() =>
              gitCreateBranch(sessionId, {
                name: r.name,
                startPoint: r.startPoint,
                checkout: r.switchTo,
              }),
            );
          }}
        />
      )}

      <DestructiveConfirm
        open={publishConfirmOpen}
        title="Publish branch?"
        tone="warning"
        description={
          status
            ? `Push ${status.branch} to origin and set it as the upstream.`
            : ""
        }
        confirmLabel="Publish branch"
        onConfirm={() => publishBranch()}
        onCancel={() => setPublishConfirmOpen(false)}
      />
    </div>
  );
}

interface RenameBranchDialogProps {
  currentBranch: string;
  onClose: () => void;
  onError: (b: BannerState) => void;
  sessionId: string;
}

function RenameBranchDialog({
  currentBranch,
  sessionId,
  onClose,
  onError,
}: RenameBranchDialogProps) {
  const [value, setValue] = useState(currentBranch);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = value.trim();
    if (!next || next === currentBranch) {
      onClose();

      return;
    }
    setBusy(true);
    try {
      await renameSessionBranch(sessionId, next);
      onClose();
    } catch (err) {
      if (err instanceof GitError) {
        onError({
          kind: err.kind,
          message: err.message,
          recovery: err.recovery,
        });
      } else {
        onError({
          kind: "unknown",
          message: err instanceof Error ? err.message : String(err),
        });
      }
      onClose();
    }
  };

  return (
    <Dialog
      title="Rename branch"
      titleId="rename-branch-title"
      onClose={onClose}
    >
      <form className={dialogStyles.form} onSubmit={submit}>
        <div className={dialogStyles.field}>
          <label className={dialogStyles.label} htmlFor="rename-branch-input">
            Branch name
          </label>
          <Input
            id="rename-branch-input"
            value={value}
            placeholder="branch-name"
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
        </div>
        <div className={dialogStyles.footer}>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={busy || !value.trim() || value.trim() === currentBranch}
          >
            {busy ? "Renaming…" : "Rename"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
