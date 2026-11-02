import type { GitViewScope, SourceView } from "../GitView";
import { useCallback, useMemo, useState } from "react";
import {
  GitErrorBanner,
  GitToolbar,
  defaultGitToolbarGroups,
  type GitErrorKind,
  type GitToolbarGroup,
} from "@argus/peacock";
import { GitError } from "../../../lib/gitError";
import { gitFetch, gitStash } from "../../../lib/ipc";
import styles from "./ChangesToolbar.module.css";

interface BannerState {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
  source: string;
}

interface ChangesToolbarProps {
  /** Active sub-view drives the search placeholder + which actions are enabled. */
  activeView: SourceView;
  onCreateBranch?: () => void;
  onNavigate: (view: SourceView) => void;
  onPullDialog?: () => void;
  onPushDialog?: () => void;
  onRefresh: () => void;
  onRenameBranch?: () => void;
  onSearchChange: (query: string) => void;
  onSearchSubmit?: () => void;
  onStashDialog?: () => void;
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
  onCreateBranch,
  onNavigate,
  onPullDialog,
  onPushDialog,
  onRenameBranch,
  onStashDialog,
  onTagSignal,
}: ChangesToolbarProps) {
  const [banner, setBanner] = useState<BannerState | null>(null);

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

  const onStash = useCallback(() => onStashDialog?.(), [onStashDialog]);

  const onBranch = useCallback(() => {
    if (scope === "project") {
      if (onCreateBranch) {
        onCreateBranch();
      } else {
        onNavigate("history");
      }
    } else if (onRenameBranch) {
      onRenameBranch();
    }
  }, [scope, onCreateBranch, onNavigate, onRenameBranch]);

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
      <div className={styles.shell}>
        <div className={styles.toolbarRow}>
          <GitToolbar
            groups={groups}
            searchPlaceholder={searchPlaceholder}
            searchValue={searchQuery}
            onSearchChange={onSearchChange}
            onSearchSubmit={onSearchSubmit}
          />
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
