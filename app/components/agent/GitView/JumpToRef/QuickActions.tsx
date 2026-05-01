/**
 * Phase 6 — Quick Actions palette (Cmd+Shift+A).
 *
 * Extends the original JumpToRef (Cmd+L) with tabbed results across five
 * categories: Branches, Files, Commits, Submodules, Views.  Each row has a
 * default action and expandable alternates.
 *
 * Files tab is seeded from git status changed-file paths.  A full
 * `git ls-files` IPC will be added in Phase 11 to populate it completely.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DestructiveConfirm,
  Dialog,
  GitErrorBanner,
  Icons,
  Input,
  type GitErrorKind,
} from "@argus/peacock";
import { GitError } from "../../../../lib/gitError";
import {
  gitCheckout,
  gitCherryPick,
  gitDeleteBranch,
  gitListLocalBranches,
  gitLog,
  gitMergeBranch,
  gitPinBranch,
  gitRebaseOnto,
  gitSubmoduleList,
  listSessionFiles,
  type EnrichedBranch,
  type GitCommit,
  type GitSubmodule,
} from "../../../../lib/ipc";
import {
  openFileHistory,
  requestFocusCommit,
} from "../../../../stores/gitUiStore";
import styles from "./QuickActions.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = "branches" | "commits" | "files" | "submodules" | "views";

const TABS: Tab[] = ["branches", "files", "commits", "submodules", "views"];

interface ViewEntry {
  id: string;
  kind: "view";
  label: string;
}

const VIEW_ENTRIES: ViewEntry[] = [
  { kind: "view", id: "working-copy", label: "Working Copy" },
  { kind: "view", id: "history", label: "History" },
  { kind: "view", id: "stashes", label: "Stashes" },
  { kind: "view", id: "submodules", label: "Submodules" },
  { kind: "view", id: "reflog", label: "Reflog" },
  { kind: "view", id: "settings", label: "Settings" },
  { kind: "view", id: "hooks", label: "Hooks" },
];

interface BannerState {
  kind: GitErrorKind;
  message: string;
  recovery?: string;
}

interface DeleteState {
  branchName: string;
}

export interface QuickActionsProps {
  onClose: () => void;
  onNavigateView: (viewId: string) => void;
  onSelectBranch: (branchName: string) => void;
  onSelectCommit: (hash: string) => void;
  repoRoot: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tabLabel(t: Tab): string {
  switch (t) {
    case "branches":
      return "Branches";
    case "files":
      return "Files";
    case "commits":
      return "Commits";
    case "submodules":
      return "Submodules";
    case "views":
      return "Views";
  }
}

// ---------------------------------------------------------------------------
// Row sub-components
// ---------------------------------------------------------------------------

interface BranchRowProps {
  active: boolean;
  branch: EnrichedBranch;
  expanded: boolean;
  index: number;
  onAlt: (action: "compare" | "delete" | "merge" | "pin" | "rebase") => void;
  onDefault: () => void;
  onHover: () => void;
  onToggleExpand: () => void;
}

function BranchRow({
  branch,
  active,
  expanded,
  index,
  onDefault,
  onHover,
  onToggleExpand,
  onAlt,
}: BranchRowProps) {
  return (
    <li
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      data-row-index={index}
      role="option"
      onClick={onDefault}
      onMouseEnter={onHover}
    >
      <Icons.BranchIcon size={12} className={styles.rowIcon} />
      <span className={styles.label}>
        {branch.name}
        {branch.isCurrent && (
          <span className={styles.currentBadge}>current</span>
        )}
      </span>
      {(branch.ahead > 0 || branch.behind > 0) && (
        <span className={styles.aheadBehind}>
          {branch.ahead > 0 && `+${branch.ahead}`}
          {branch.ahead > 0 && branch.behind > 0 && " "}
          {branch.behind > 0 && `-${branch.behind}`}
        </span>
      )}
      <span className={styles.hint}>checkout</span>
      <button
        aria-label="Show alternate actions"
        className={styles.expandBtn}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        <Icons.ChevronDownIcon
          size={8}
          className={expanded ? styles.chevronUp : undefined}
        />
      </button>
      {expanded && (
        <ul className={styles.altList}>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("merge");
            }}
          >
            <Icons.MergeIcon size={10} />
            Merge into current
          </li>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("rebase");
            }}
          >
            <Icons.HistoryIcon size={10} />
            Rebase onto
          </li>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("compare");
            }}
          >
            <Icons.SplitViewIcon size={10} />
            Compare
          </li>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("pin");
            }}
          >
            <Icons.PinIcon size={10} />
            Pin branch
          </li>
          <li
            className={`${styles.altItem} ${styles.altItemDestructive}`}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("delete");
            }}
          >
            <Icons.TrashIcon size={10} />
            Delete branch
          </li>
        </ul>
      )}
    </li>
  );
}

interface FileRowProps {
  active: boolean;
  expanded: boolean;
  index: number;
  onAlt: (action: "blame" | "editor") => void;
  onDefault: () => void;
  onHover: () => void;
  onToggleExpand: () => void;
  path: string;
}

function FileRow({
  path,
  active,
  expanded,
  index,
  onDefault,
  onHover,
  onToggleExpand,
  onAlt,
}: FileRowProps) {
  const filename = path.split("/").pop() ?? path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

  return (
    <li
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      data-row-index={index}
      role="option"
      onClick={onDefault}
      onMouseEnter={onHover}
    >
      <Icons.FileIcon size={12} className={styles.rowIcon} />
      <span className={styles.label}>
        {filename}
        {dir && <span className={styles.dirHint}> {dir}</span>}
      </span>
      <span className={styles.hint}>file history</span>
      <button
        aria-label="Show alternate actions"
        className={styles.expandBtn}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        <Icons.ChevronDownIcon
          size={8}
          className={expanded ? styles.chevronUp : undefined}
        />
      </button>
      {expanded && (
        <ul className={styles.altList}>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("editor");
            }}
          >
            <Icons.PencilIcon size={10} />
            Open in Editor
          </li>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("blame");
            }}
          >
            <Icons.HistoryIcon size={10} />
            Blame (Phase 11)
          </li>
        </ul>
      )}
    </li>
  );
}

interface CommitRowProps {
  active: boolean;
  commit: GitCommit;
  expanded: boolean;
  index: number;
  onAlt: (action: "cherry-pick") => void;
  onDefault: () => void;
  onHover: () => void;
  onToggleExpand: () => void;
}

function CommitRow({
  commit,
  active,
  expanded,
  index,
  onDefault,
  onHover,
  onToggleExpand,
  onAlt,
}: CommitRowProps) {
  return (
    <li
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      data-row-index={index}
      role="option"
      onClick={onDefault}
      onMouseEnter={onHover}
    >
      <Icons.ClockIcon size={12} className={styles.rowIcon} />
      <span className={styles.hash}>{commit.abbreviatedHash}</span>
      <span className={styles.label}>{commit.subject}</span>
      <span className={styles.hint}>reveal</span>
      <button
        aria-label="Show alternate actions"
        className={styles.expandBtn}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        <Icons.ChevronDownIcon
          size={8}
          className={expanded ? styles.chevronUp : undefined}
        />
      </button>
      {expanded && (
        <ul className={styles.altList}>
          <li
            className={styles.altItem}
            onClick={(e) => {
              e.stopPropagation();
              onAlt("cherry-pick");
            }}
          >
            <Icons.CheckIcon size={10} />
            Cherry-pick
          </li>
        </ul>
      )}
    </li>
  );
}

interface SubmoduleRowProps {
  active: boolean;
  index: number;
  onDefault: () => void;
  onHover: () => void;
  submodule: GitSubmodule;
}

function SubmoduleRow({
  submodule,
  active,
  index,
  onDefault,
  onHover,
}: SubmoduleRowProps) {
  let statusClass = styles.statusUninitialized;
  if (submodule.status === "clean") {
    statusClass = styles.statusClean;
  } else if (submodule.status === "modified") {
    statusClass = styles.statusModified;
  }

  return (
    <li
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      data-row-index={index}
      role="option"
      onClick={onDefault}
      onMouseEnter={onHover}
    >
      <Icons.FolderIcon size={12} className={styles.rowIcon} />
      <span className={styles.label}>{submodule.name}</span>
      <span className={styles.subPath}>{submodule.path}</span>
      <span className={`${styles.statusDot} ${statusClass}`} />
      <span className={styles.hint}>open</span>
    </li>
  );
}

interface ViewRowProps {
  active: boolean;
  index: number;
  onDefault: () => void;
  onHover: () => void;
  view: ViewEntry;
}

function ViewRow({ view, active, index, onDefault, onHover }: ViewRowProps) {
  return (
    <li
      aria-selected={active}
      className={`${styles.row} ${active ? styles.rowActive : ""}`}
      data-row-index={index}
      role="option"
      onClick={onDefault}
      onMouseEnter={onHover}
    >
      <Icons.GitChangesIcon size={12} className={styles.rowIcon} />
      <span className={styles.label}>{view.label}</span>
      <span className={styles.hint}>navigate</span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function QuickActions({
  repoRoot,
  sessionId,
  onClose,
  onSelectBranch,
  onSelectCommit,
  onNavigateView,
}: QuickActionsProps) {
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("branches");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  // Track previous query/tab to detect changes and reset index at render time
  // (per React 19 guidance — no setState inside effects for derived state).
  const [prevQuery, setPrevQuery] = useState(query);
  const [prevTab, setPrevTab] = useState<Tab>(activeTab);
  const listRef = useRef<HTMLUListElement>(null);

  // Data
  const [branches, setBranches] = useState<EnrichedBranch[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [submodules, setSubmodules] = useState<GitSubmodule[]>([]);

  // Op state
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);

  useEffect(() => {
    let cancelled = false;

    gitListLocalBranches(sessionId)
      .then((b) => {
        if (!cancelled) {
          setBranches(b);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranches([]);
        }
      });

    gitLog(sessionId, 50, false)
      .then((c) => {
        if (!cancelled) {
          setCommits(c);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommits([]);
        }
      });

    gitSubmoduleList(sessionId)
      .then((s) => {
        if (!cancelled) {
          setSubmodules(s);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSubmodules([]);
        }
      });

    // Seed the Files tab from the session worktree file list.
    listSessionFiles(sessionId)
      .then((f) => {
        if (!cancelled) {
          setFiles(f);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFiles([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ---------------------------------------------------------------------------
  // Filtered lists per tab
  // ---------------------------------------------------------------------------

  const q = query.trim().toLowerCase();

  const filteredBranches = useMemo(
    () =>
      branches.filter(
        (b) =>
          !q ||
          b.name.toLowerCase().includes(q) ||
          b.fullName.toLowerCase().includes(q),
      ),
    [branches, q],
  );

  const filteredFiles = useMemo(
    () => files.filter((f) => !q || f.toLowerCase().includes(q)),
    [files, q],
  );

  const filteredCommits = useMemo(
    () =>
      commits.filter(
        (c) =>
          !q ||
          c.subject.toLowerCase().includes(q) ||
          c.hash.toLowerCase().startsWith(q) ||
          c.abbreviatedHash.toLowerCase().startsWith(q) ||
          c.author.toLowerCase().includes(q),
      ),
    [commits, q],
  );

  const filteredSubmodules = useMemo(
    () =>
      submodules.filter(
        (s) =>
          !q ||
          s.name.toLowerCase().includes(q) ||
          s.path.toLowerCase().includes(q),
      ),
    [submodules, q],
  );

  const filteredViews = useMemo(
    () => VIEW_ENTRIES.filter((v) => !q || v.label.toLowerCase().includes(q)),
    [q],
  );

  const activeCount = useMemo(() => {
    switch (activeTab) {
      case "branches":
        return filteredBranches.length;
      case "files":
        return filteredFiles.length;
      case "commits":
        return filteredCommits.length;
      case "submodules":
        return filteredSubmodules.length;
      case "views":
        return filteredViews.length;
    }
  }, [
    activeTab,
    filteredBranches,
    filteredFiles,
    filteredCommits,
    filteredSubmodules,
    filteredViews,
  ]);

  // Reset index when query or tab changes — at render time (React 19 pattern).
  if (query !== prevQuery || activeTab !== prevTab) {
    setPrevQuery(query);
    setPrevTab(activeTab);
    setActiveIndex(0);
    setExpandedIndex(null);
  }

  // Clamp index when list shrinks — at render time per React 19 guidance.
  const cappedIndex = Math.min(activeIndex, Math.max(0, activeCount - 1));
  if (cappedIndex !== activeIndex) {
    setActiveIndex(cappedIndex);
  }

  // Scroll active row into view
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-row-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const runOp = useCallback(
    (op: () => Promise<unknown>): void => {
      setBanner(null);
      op()
        .then(() => onClose())
        .catch((err: unknown) => {
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
        });
    },
    [onClose],
  );

  const defaultAction = useCallback(() => {
    switch (activeTab) {
      case "branches": {
        const branch = filteredBranches[activeIndex];
        if (branch) {
          runOp(() => gitCheckout(sessionId, { branch: branch.name }));
          onSelectBranch(branch.name);
        }
        break;
      }
      case "files": {
        const file = filteredFiles[activeIndex];
        if (file) {
          openFileHistory(sessionId, file);
          onClose();
        }
        break;
      }
      case "commits": {
        const commit = filteredCommits[activeIndex];
        if (commit) {
          onSelectCommit(commit.hash);
          requestFocusCommit(commit.hash);
          onClose();
        }
        break;
      }
      case "submodules": {
        const sub = filteredSubmodules[activeIndex];
        if (sub) {
          onNavigateView("submodules");
          onClose();
        }
        break;
      }
      case "views": {
        const view = filteredViews[activeIndex];
        if (view) {
          onNavigateView(view.id);
          onClose();
        }
        break;
      }
    }
  }, [
    activeTab,
    activeIndex,
    filteredBranches,
    filteredFiles,
    filteredCommits,
    filteredSubmodules,
    filteredViews,
    sessionId,
    onClose,
    onSelectBranch,
    onSelectCommit,
    onNavigateView,
    runOp,
  ]);

  const handleBranchAlt = useCallback(
    (
      branch: EnrichedBranch,
      action: "compare" | "delete" | "merge" | "pin" | "rebase",
    ) => {
      switch (action) {
        case "merge":
          runOp(() => gitMergeBranch(sessionId, { from: branch.name }));
          break;
        case "rebase":
          runOp(() => gitRebaseOnto(sessionId, { upstream: branch.name }));
          break;
        case "compare":
          onNavigateView("history");
          onClose();
          break;
        case "pin":
          runOp(() => gitPinBranch(repoRoot, branch.name));
          break;
        case "delete":
          setDeleteState({ branchName: branch.name });
          break;
      }
    },
    [sessionId, repoRoot, onClose, onNavigateView, runOp],
  );

  const handleCommitAlt = useCallback(
    (commit: GitCommit, action: "cherry-pick") => {
      if (action === "cherry-pick") {
        runOp(() => gitCherryPick(sessionId, { hash: commit.hash }));
      }
    },
    [sessionId, runOp],
  );

  // ---------------------------------------------------------------------------
  // Keyboard handling
  // ---------------------------------------------------------------------------

  const onInputKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setExpandedIndex(null);
        setActiveIndex((i) =>
          activeCount === 0 ? 0 : Math.min(i + 1, activeCount - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setExpandedIndex(null);
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Tab") {
        e.preventDefault();
        setActiveTab((t) => {
          const idx = TABS.indexOf(t);

          return TABS[(idx + 1) % TABS.length]!;
        });
        setActiveIndex(0);
        setExpandedIndex(null);
      } else if (e.key === "Enter") {
        e.preventDefault();
        defaultAction();
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [activeCount, defaultAction, onClose],
  );

  // ---------------------------------------------------------------------------
  // Render rows
  // ---------------------------------------------------------------------------

  const renderRows = () => {
    switch (activeTab) {
      case "branches":
        if (filteredBranches.length === 0) {
          return <li className={styles.empty}>No branches match</li>;
        }

        return filteredBranches.map((branch, i) => (
          <BranchRow
            key={branch.fullName}
            active={i === activeIndex}
            branch={branch}
            expanded={expandedIndex === i}
            index={i}
            onAlt={(action) => handleBranchAlt(branch, action)}
            onDefault={defaultAction}
            onHover={() => {
              setActiveIndex(i);
              setExpandedIndex(null);
            }}
            onToggleExpand={() =>
              setExpandedIndex((prev) => (prev === i ? null : i))
            }
          />
        ));

      case "files":
        if (filteredFiles.length === 0) {
          return (
            <li className={styles.empty}>
              {files.length === 0
                ? "No changed files — more files available in Phase 11"
                : "No files match"}
            </li>
          );
        }

        return filteredFiles.map((file, i) => (
          <FileRow
            key={file}
            active={i === activeIndex}
            expanded={expandedIndex === i}
            index={i}
            path={file}
            onAlt={(action) => {
              if (action === "editor") {
                // openInEditor requires an editorId; navigate to working copy
                // where the user can open via context menu.
                onNavigateView("working-copy");
              }
              // blame — Phase 11 placeholder
              onClose();
            }}
            onDefault={defaultAction}
            onHover={() => {
              setActiveIndex(i);
              setExpandedIndex(null);
            }}
            onToggleExpand={() =>
              setExpandedIndex((prev) => (prev === i ? null : i))
            }
          />
        ));

      case "commits":
        if (filteredCommits.length === 0) {
          return <li className={styles.empty}>No commits match</li>;
        }

        return filteredCommits.map((commit, i) => (
          <CommitRow
            key={commit.hash}
            active={i === activeIndex}
            commit={commit}
            expanded={expandedIndex === i}
            index={i}
            onAlt={(action) => handleCommitAlt(commit, action)}
            onDefault={defaultAction}
            onHover={() => {
              setActiveIndex(i);
              setExpandedIndex(null);
            }}
            onToggleExpand={() =>
              setExpandedIndex((prev) => (prev === i ? null : i))
            }
          />
        ));

      case "submodules":
        if (filteredSubmodules.length === 0) {
          return (
            <li className={styles.empty}>
              {submodules.length === 0
                ? "No submodules"
                : "No submodules match"}
            </li>
          );
        }

        return filteredSubmodules.map((sub, i) => (
          <SubmoduleRow
            key={sub.path}
            active={i === activeIndex}
            index={i}
            submodule={sub}
            onDefault={defaultAction}
            onHover={() => setActiveIndex(i)}
          />
        ));

      case "views":
        if (filteredViews.length === 0) {
          return <li className={styles.empty}>No views match</li>;
        }

        return filteredViews.map((view, i) => (
          <ViewRow
            key={view.id}
            active={i === activeIndex}
            index={i}
            view={view}
            onDefault={defaultAction}
            onHover={() => setActiveIndex(i)}
          />
        ));
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Dialog
        onClose={onClose}
        size="medium"
        title="Quick Actions"
        titleId={titleId}
      >
        <div className={styles.body}>
          {banner && (
            <GitErrorBanner
              kind={banner.kind}
              message={banner.message}
              recovery={banner.recovery}
              onDismiss={() => setBanner(null)}
            />
          )}
          <Input
            autoFocus
            aria-label="Search quick actions"
            placeholder="Search branches, files, commits, submodules, views…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
          />
          <div className={styles.tabs} role="tablist">
            {TABS.map((t) => (
              <button
                key={t}
                aria-selected={t === activeTab}
                className={`${styles.tab} ${t === activeTab ? styles.tabActive : ""}`}
                role="tab"
                onClick={() => {
                  setActiveTab(t);
                  setActiveIndex(0);
                  setExpandedIndex(null);
                }}
              >
                {tabLabel(t)}
              </button>
            ))}
          </div>
          <ul ref={listRef} className={styles.list} role="listbox">
            {renderRows()}
          </ul>
          <p className={styles.footer}>
            Enter to confirm &middot; Tab cycles tabs &middot; &uarr;&darr;
            navigate &middot; chevron for alternates
          </p>
        </div>
      </Dialog>

      {deleteState && (
        <DestructiveConfirm
          open
          confirmLabel="Delete"
          description={`"${deleteState.branchName}" will be permanently deleted. This cannot be undone.`}
          title={`Delete branch "${deleteState.branchName}"?`}
          onCancel={() => setDeleteState(null)}
          onConfirm={() => {
            const name = deleteState.branchName;
            setDeleteState(null);
            runOp(() => gitDeleteBranch(sessionId, { name }));
          }}
        />
      )}
    </>
  );
}

/** Back-compat alias so existing `import { JumpToRef }` sites continue to compile. */
export { QuickActions as JumpToRef };
export type { QuickActionsProps as JumpToRefProps };
