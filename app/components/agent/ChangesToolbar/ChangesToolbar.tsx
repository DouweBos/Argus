import type { GitViewScope, SourceView } from "../GitView";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  GitErrorBanner,
  GitToolbar,
  Icons,
  StashDialog,
  Toggle,
  defaultGitToolbarGroups,
  type GitErrorKind,
  type GitToolbarGroup,
} from "@argus/peacock";
import { useOutsideClick } from "../../../hooks/useOutsideClick";
import { GitError } from "../../../lib/gitError";
import { gitFetch, gitStash, gitStashSave } from "../../../lib/ipc";
import {
  setShowAssumeUnchangedFiles,
  setShowIgnoredFiles,
  setShowNonModifiedFiles,
  useShowAssumeUnchangedFiles,
  useShowIgnoredFiles,
  useShowNonModifiedFiles,
} from "../../../stores/settingsStore";
import styles from "./ChangesToolbar.module.css";

interface BannerState {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
  source: string;
}

/**
 * Popover with view-toggle switches for the working-copy file list.
 * State persists in settingsStore.
 */
function ViewOptionsPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const showIgnored = useShowIgnoredFiles();
  const showAssumeUnchanged = useShowAssumeUnchangedFiles();
  const showNonModified = useShowNonModifiedFiles();
  useOutsideClick(ref, true, onClose);

  return (
    <div ref={ref} className={styles.viewOptionsPanel}>
      <div className={styles.viewOptionsPanelTitle}>View options</div>
      <label className={styles.viewOptionsRow}>
        <Toggle
          checked={showIgnored}
          size="sm"
          onChange={setShowIgnoredFiles}
        />
        <span className={styles.viewOptionsLabel}>Show ignored files</span>
      </label>
      <label className={styles.viewOptionsRow}>
        <Toggle
          checked={showAssumeUnchanged}
          size="sm"
          onChange={setShowAssumeUnchangedFiles}
        />
        <span className={styles.viewOptionsLabel}>
          Show assume-unchanged files
        </span>
      </label>
      <label className={styles.viewOptionsRow}>
        <Toggle
          checked={showNonModified}
          size="sm"
          onChange={setShowNonModifiedFiles}
        />
        <span className={styles.viewOptionsLabel}>
          Show non-modified files (tree mode)
        </span>
      </label>
    </div>
  );
}

interface ChangesToolbarProps {
  /** Active sub-view drives the search placeholder + which actions are enabled. */
  activeView: SourceView;
  onNavigate: (view: SourceView) => void;
  onPullDialog?: () => void;
  onPushDialog?: () => void;
  onRefresh: () => void;
  onRenameBranch?: () => void;
  onSearchChange: (query: string) => void;
  onSearchSubmit?: () => void;
  onTagSignal?: () => void;
  repoRoot: string;
  scope: GitViewScope;
  searchQuery: string;
  sessionId: string;
}

const SEARCH_PLACEHOLDER: Partial<Record<SourceView, string>> = {
  history: "Search for Message",
  "pull-requests": "Search for Title or Body",
  "branches-review": "Search for Branch with Name",
  stashes: "Search for Stash Message",
  "working-copy": "Search for File",
};

export function ChangesToolbar({
  activeView,
  scope,
  sessionId,
  repoRoot: _repoRoot,
  searchQuery,
  onSearchChange,
  onSearchSubmit,
  onRefresh,
  onNavigate,
  onPullDialog,
  onPushDialog,
  onRenameBranch,
  onTagSignal,
}: ChangesToolbarProps) {
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [stashDialogOpen, setStashDialogOpen] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);

  const runAction = useCallback(
    async (name: string, action: () => Promise<unknown>): Promise<void> => {
      try {
        await action();
        setBanner(null);
        onRefresh();
      } catch (err) {
        if (err instanceof GitError) {
          setBanner({
            kind: err.kind,
            message: err.message,
            recovery: err.recovery,
            source: name,
          });
        } else {
          setBanner({
            kind: "unknown",
            message: err instanceof Error ? err.message : String(err),
            source: name,
          });
        }
      }
    },
    [onRefresh],
  );

  const onPull = useCallback(() => {
    if (onPullDialog) {
      onPullDialog();
    }
  }, [onPullDialog]);

  const onPush = useCallback(() => {
    if (onPushDialog) {
      onPushDialog();
    }
  }, [onPushDialog]);

  const onStash = useCallback(() => setStashDialogOpen(true), []);

  const onBranch = useCallback(() => {
    if (scope === "project") {
      onNavigate("history");
    } else if (onRenameBranch) {
      onRenameBranch();
    }
  }, [scope, onNavigate, onRenameBranch]);

  const onTag = useCallback(() => {
    if (scope === "project" && onTagSignal) {
      onTagSignal();
    }
  }, [scope, onTagSignal]);

  const onMerge = useCallback(() => {
    if (scope === "project") {
      onNavigate("history");
    }
  }, [scope, onNavigate]);

  const onUndo = useCallback(() => onNavigate("reflog"), [onNavigate]);
  const onRedo = useCallback(() => onNavigate("reflog"), [onNavigate]);
  const onRefreshClick = useCallback(() => {
    onRefresh();
    runAction("fetch", () => gitFetch(sessionId)).catch(() => undefined);
  }, [onRefresh, runAction, sessionId]);

  const groups: GitToolbarGroup[] = useMemo(() => {
    const base = defaultGitToolbarGroups(
      {
        onPull,
        onPush,
        onStash,
        onBranch,
        onTag,
        onMerge,
        onUndo,
        onRedo,
        onRefresh: onRefreshClick,
      },
      {
        tag: scope !== "project",
        merge: scope !== "project",
        redo: true,
      },
    );

    return base;
  }, [
    scope,
    onPull,
    onPush,
    onStash,
    onBranch,
    onTag,
    onMerge,
    onUndo,
    onRedo,
    onRefreshClick,
  ]);

  const searchPlaceholder = SEARCH_PLACEHOLDER[activeView] ?? "Search";

  return (
    <>
      <StashDialog
        open={stashDialogOpen}
        onCancel={() => setStashDialogOpen(false)}
        onConfirm={(opts) => {
          setStashDialogOpen(false);
          runAction("stash", () => gitStashSave(sessionId, opts));
        }}
      />
      <div className={styles.shell}>
        <div className={styles.toolbarRow}>
          <GitToolbar
            groups={groups}
            searchPlaceholder={searchPlaceholder}
            searchValue={searchQuery}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
          />
          <div className={styles.viewOptionsAnchor}>
            <button
              type="button"
              className={styles.viewOptionsBtn}
              title="View options"
              aria-label="View options"
              aria-expanded={viewOptionsOpen}
              onClick={() => setViewOptionsOpen((o) => !o)}
            >
              <Icons.FilterIcon size={13} />
            </button>
            {viewOptionsOpen && (
              <ViewOptionsPopover onClose={() => setViewOptionsOpen(false)} />
            )}
          </div>
        </div>
      </div>
      {banner && banner.kind === "busy" && (
        <GitErrorBanner
          kind="busy"
          message={banner.message}
          variant="transient"
          onDismiss={() => setBanner(null)}
        />
      )}
      {banner && banner.kind !== "busy" && (
        <GitErrorBanner
          kind={banner.kind}
          message={banner.message}
          recovery={banner.recovery}
          onDismiss={() => setBanner(null)}
          onAction={async (actionId) => {
            if (actionId === "retry") {
              setBanner(null);
              onRefresh();

              return;
            }
            if (actionId === "copy-stderr") {
              navigator.clipboard
                ?.writeText(banner.message)
                .catch(() => undefined);

              return;
            }
            if (actionId === "stash-and-retry") {
              try {
                await gitStash(sessionId);
                onRefresh();
              } catch {
                /* falls through to next banner cycle */
              }

              return;
            }
            // eslint-disable-next-line no-console
            console.warn(`[git] action "${actionId}" not wired`);
          }}
        />
      )}
    </>
  );
}
