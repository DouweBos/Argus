/**
 * SidebarRefSection — collapsible domain-data sections for the project-scope
 * git sidebar (Pinned Branches, Branches, Tags, Remotes, Submodules, Worktrees,
 * Archived Branches).
 *
 * Section headers mirror the app shell's `SidebarSection` styling:
 * left-aligned uppercase eyebrow, trailing chevron, full-width hit target.
 * Default collapsed-state is per-section (Branches open by default; Tags,
 * Remotes, Archived collapsed by default). Folder rows inside Branches/Tags
 * are collapsed by default too — except ancestor folders of the currently
 * checked-out branch, which auto-open so the user always sees where they are.
 */
import type {
  EnrichedBranch,
  GitSubmodule,
  GitTag,
  GitWorktree,
  RemoteBranch,
} from "../../../lib/ipc";
import type { InterestingPullRequest } from "../../../lib/types";
import type { SourceView } from "../GitView";
import type { BranchTreeNode } from "../GitView/BranchesView/branchTree";
import { useEffect, useId, useRef, useState } from "react";
import {
  Badge,
  BranchDialog,
  Button,
  ContextMenu,
  DestructiveConfirm,
  Dialog,
  DialogBody,
  DialogFooter,
  Icons,
  Input,
  PushDialog,
  SidebarBranchFolder,
  SidebarBranchRow,
  type BranchDialogResult,
  type ContextMenuItem,
  type PushDialogResult,
  useDraggable,
  useDropTarget,
} from "@argus/peacock";
import { rehydrateGitError } from "../../../lib/gitError";
import { GitError } from "../../../lib/gitError";
import {
  gitArchiveBranch,
  gitCheckout,
  gitCherryPick,
  gitCreateBranch,
  gitDeleteBranch,
  gitDiscardAndCheckout,
  gitMergeBranch,
  gitPinBranch,
  gitPullV2,
  gitPushV2,
  gitRebaseOnto,
  gitReset,
  gitRevert,
  gitSetUpstream,
  gitStashAndCheckout,
  gitUnarchiveBranch,
  gitUnpinBranch,
  openExternalUrl,
  setSessionBaseBranch,
} from "../../../lib/ipc";
import { useRouteGitRefName, useRouteGitView } from "../../../lib/routeHooks";
import { setGitCompareView, setGitRef } from "../../../stores/editorStore";
import { pushError } from "../../../stores/notificationsStore";
import { usePrsByBranch } from "../../../stores/pullRequestStore";
import {
  setGitSidebarSectionCollapsed,
  useGitSidebarSectionsCollapsed,
} from "../../../stores/settingsStore";
import { buildLocalTree } from "../GitView/BranchesView/branchTree";
import styles from "./SidebarRefSection.module.css";

interface RefSectionProps {
  onViewChange: (view: SourceView) => void;
  /** Project root path — needed for PR lookup and archived-branch IPC. */
  repoRoot: string;
  sessionId: string;
}

/* ── Error helpers ───────────────────────────────────────────────────── */

function errorMessage(err: unknown): string {
  const gitErr = rehydrateGitError(err);
  if (gitErr) {
    return gitErr.message;
  }

  return err instanceof Error ? err.message : String(err);
}

function reportCheckoutError(err: unknown, branchName: string): void {
  pushError(errorMessage(err), `Checkout ${branchName}`);
}

/* ── Collapsed-state helpers ─────────────────────────────────────────── */

/** True when the section/folder should render collapsed right now. */
function isCollapsed(
  map: Record<string, boolean>,
  key: string,
  defaultCollapsed: boolean,
): boolean {
  const explicit = map[key];

  return explicit === undefined ? defaultCollapsed : explicit;
}

function toggleCollapsed(
  map: Record<string, boolean>,
  key: string,
  defaultCollapsed: boolean,
): void {
  setGitSidebarSectionCollapsed(key, !isCollapsed(map, key, defaultCollapsed));
}

/** All ancestor folder paths of `branch/with/slashes` — `["branch", "branch/with"]`. */
function ancestorFolderPaths(branchName: string): Set<string> {
  const out = new Set<string>();
  const segs = branchName.split("/");
  for (let i = 1; i < segs.length; i++) {
    out.add(segs.slice(0, i).join("/"));
  }

  return out;
}

/* ── Collapsible section wrapper ─────────────────────────────────────── */

interface CollapsibleSectionProps {
  children: React.ReactNode;
  collapsed: boolean;
  /** Optional drop-target props forwarded to the header button. */
  dropProps?: {
    isOver: boolean;
    onDragEnter: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  label: string;
  onToggle: () => void;
}

function CollapsibleSection({
  label,
  collapsed,
  onToggle,
  dropProps,
  children,
}: CollapsibleSectionProps) {
  const headerClass = [
    styles.sectionHeader,
    dropProps?.isOver ? styles.sectionHeaderOver : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <button
        type="button"
        className={headerClass}
        aria-expanded={!collapsed}
        onClick={onToggle}
        onDragEnter={dropProps?.onDragEnter}
        onDragLeave={dropProps?.onDragLeave}
        onDragOver={dropProps?.onDragOver}
        onDrop={dropProps?.onDrop}
      >
        <span className={styles.sectionLabel}>{label}</span>
        <span
          className={`${styles.sectionChevron} ${collapsed ? styles.sectionChevronCollapsed : ""}`}
          aria-hidden="true"
        >
          <Icons.ChevronDownIcon size={12} />
        </span>
      </button>
      {!collapsed && <div className={styles.list}>{children}</div>}
    </>
  );
}

/* ── Dirty-checkout dialog ───────────────────────────────────────────── */

interface DirtyCheckoutDialogProps {
  branch: string;
  onCancel: () => void;
  onDiscard: () => void;
  onStash: () => void;
}

function DirtyCheckoutDialog({
  branch,
  onStash,
  onDiscard,
  onCancel,
}: DirtyCheckoutDialogProps) {
  const titleId = useId();

  return (
    <Dialog title="Uncommitted changes" titleId={titleId} onClose={onCancel}>
      <DialogBody>
        <p className={styles.dialogDesc}>
          You have uncommitted changes. Choose how to handle them before
          switching to &ldquo;{branch}&rdquo;.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={onDiscard}>
          Discard &amp; switch
        </Button>
        <Button variant="primary" onClick={onStash}>
          Stash &amp; switch
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Upstream dialog ─────────────────────────────────────────────────── */

interface UpstreamDialogProps {
  branch: string;
  defaultValue: string;
  onCancel: () => void;
  onSubmit: (upstream: string) => void;
}

function UpstreamDialog({
  branch,
  defaultValue,
  onSubmit,
  onCancel,
}: UpstreamDialogProps) {
  const titleId = useId();
  const [value, setValue] = useState(defaultValue);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  };

  return (
    <Dialog
      title={`Set upstream for "${branch}"`}
      titleId={titleId}
      onClose={onCancel}
    >
      <DialogBody>
        <p className={styles.dialogDesc}>
          Enter the upstream tracking branch (e.g. <code>origin/main</code>).
        </p>
        <Input
          autoFocus
          placeholder="origin/main"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          Set upstream
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

/* ── Branches ────────────────────────────────────────────────────────── */

export interface BranchesSectionProps extends RefSectionProps {
  archivedBranches: string[];
  branches: EnrichedBranch[];
  /** Default branch (`main` / `master` / repo-configured). Pinned at top. */
  defaultBranch?: string | null;
  onArchivedChange: (next: string[]) => void;
  onPinnedChange: (next: string[]) => void;
  pinnedBranches: string[];
  /** Extra branch names to float to the top of the list (e.g. from
   * `.argus.json`'s `protected_branches`). */
  priorityBranchNames?: readonly string[];
}

interface ContextMenuState {
  branch: EnrichedBranch;
  pos: { x: number; y: number };
}

type DialogState =
  | { branch: EnrichedBranch; kind: "delete" }
  | { branch: EnrichedBranch; kind: "dirty-checkout" }
  | { branch: EnrichedBranch; kind: "push" }
  | { branch: EnrichedBranch; kind: "upstream" }
  | { kind: "new-branch-from-drop"; startPoint: string };

export function BranchesSection({
  branches,
  defaultBranch,
  archivedBranches,
  onArchivedChange,
  pinnedBranches,
  onPinnedChange,
  priorityBranchNames,
  sessionId,
  repoRoot,
  onViewChange,
}: BranchesSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();
  const prsByBranch = usePrsByBranch(repoRoot);
  const routeGitView = useRouteGitView();
  const routeGitRefName = useRouteGitRefName();
  const selectedBranchName =
    routeGitView === "branches" ? routeGitRefName : null;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // Branch-on-branch drop handler: merge (default) or rebase (⌥ held).
  // Rebase with ⌥ is only valid when the dragged branch is the current branch
  // (rebase rebases HEAD onto the target). For non-current branches we fall
  // back to merge to avoid silent mistakes. This limitation is documented in
  // the changeset.
  const handleBranchDrop = (
    fromBranch: string,
    targetBranch: string,
    altHeld: boolean,
  ) => {
    if (altHeld) {
      const fromIsCurrent =
        visible.find((b) => b.name === fromBranch)?.isCurrent ?? false;
      if (fromIsCurrent) {
        gitRebaseOnto(sessionId, { upstream: targetBranch }).catch((err) =>
          pushError(errorMessage(err), "Rebase onto"),
        );
      } else {
        // Limitation: rebase is only valid for the current branch. Merge instead.
        gitMergeBranch(sessionId, {
          from: fromBranch,
          into: targetBranch,
        }).catch((err) => pushError(errorMessage(err), "Merge branch"));
      }
    } else {
      gitMergeBranch(sessionId, { from: fromBranch, into: targetBranch }).catch(
        (err) => pushError(errorMessage(err), "Merge branch"),
      );
    }
  };

  // Commit-on-branch drop handler: cherry-pick (default), reset (⌥ held), or
  // revert (⇧ held). All three ops modify HEAD, so we require the target row
  // to be the current branch. Same limitation pattern as branch→branch rebase
  // above. ⌥ is mapped to reset; revert is wired to ⇧ instead.
  const handleCommitDrop = (
    hash: string,
    targetBranch: string,
    modifier: "cherry-pick" | "reset" | "revert",
  ) => {
    const targetIsCurrent =
      visible.find((b) => b.name === targetBranch)?.isCurrent ?? false;
    const opLabel = (() => {
      if (modifier === "reset") {
        return "Reset branch";
      }
      if (modifier === "revert") {
        return "Revert commit";
      }

      return "Cherry-pick commit";
    })();
    if (!targetIsCurrent) {
      pushError(`Switch to "${targetBranch}" first.`, opLabel);

      return;
    }
    if (modifier === "reset") {
      gitReset(sessionId, { mode: "mixed", ref: hash }).catch((err) =>
        pushError(errorMessage(err), opLabel),
      );
    } else if (modifier === "revert") {
      gitRevert(sessionId, { hash }).catch((err) =>
        pushError(errorMessage(err), opLabel),
      );
    } else {
      gitCherryPick(sessionId, { hash }).catch((err) =>
        pushError(errorMessage(err), opLabel),
      );
    }
  };

  // Remote-branch-on-local-branch drop: pull (default, ff-only) or merge (⌥).
  const handleRemoteBranchOnLocal = (
    remote: string,
    remoteBranchName: string,
    targetBranch: string,
    altHeld: boolean,
  ) => {
    const targetIsCurrent =
      visible.find((b) => b.name === targetBranch)?.isCurrent ?? false;
    if (!targetIsCurrent) {
      pushError(
        `Switch to "${targetBranch}" first.`,
        altHeld ? "Merge from remote" : "Pull from remote",
      );

      return;
    }
    gitPullV2(sessionId, {
      remote,
      branch: remoteBranchName,
      strategy: altHeld ? "merge" : "ff-only",
    }).catch((err) => pushError(errorMessage(err), "Pull"));
  };

  // Drop target on the "Branches" section header — accepts branch, tag, and
  // remote-branch drags and opens BranchDialog pre-filled with the dragged
  // ref as start-point. For remote-branch drops the start-point is the fully
  // qualified `<remote>/<branch>` so the new local branch tracks it.
  const headerDrop = useDropTarget<
    | { branchName: string; isCurrent: boolean; kind: "branch" }
    | { branchName: string; kind: "remote-branch"; remote: string }
    | { kind: "tag"; tagName: string }
  >({
    accepts: ["branch", "tag", "remote-branch"],
    label: "Branch from …",
    onDrop: (payload) => {
      let startPoint: string;
      if (payload.kind === "branch") {
        startPoint = payload.branchName;
      } else if (payload.kind === "tag") {
        startPoint = payload.tagName;
      } else {
        startPoint = `${payload.remote}/${payload.branchName}`;
      }
      setDialog({ kind: "new-branch-from-drop", startPoint });
    },
  });

  const archivedSet = new Set(archivedBranches);
  const pinnedSet = new Set(pinnedBranches);
  const visible = branches.filter((b) => !archivedSet.has(b.name));

  const currentBranch = visible.find((b) => b.isCurrent);
  const ancestorPaths = currentBranch
    ? ancestorFolderPaths(currentBranch.name)
    : new Set<string>();

  // Auto-expand ancestor folders of the checked-out branch whenever HEAD
  // changes. We clear the stored collapse state (rather than forcing open)
  // so the user can collapse the folder again afterwards.
  const lastCurrentRef = useRef<string | null>(null);
  useEffect(() => {
    const name = currentBranch?.name ?? null;
    if (name === lastCurrentRef.current) {
      return;
    }
    lastCurrentRef.current = name;
    if (!name) {
      return;
    }
    for (const path of ancestorFolderPaths(name)) {
      setGitSidebarSectionCollapsed(`branch-folder:${path}`, false);
    }
  }, [currentBranch?.name]);

  // Pin the default branch at the top, outside the folder tree.
  const defaultName =
    defaultBranch && visible.find((b) => b.name === defaultBranch)
      ? defaultBranch
      : null;
  const pinned = defaultName
    ? visible.find((b) => b.name === defaultName)
    : null;
  const rest = pinned ? visible.filter((b) => b.name !== defaultName) : visible;

  const tree = buildLocalTree(rest, priorityBranchNames);

  const doCheckout = (branch: EnrichedBranch) => {
    if (branch.isCurrent) {
      doShowHistory(branch);

      return;
    }
    gitCheckout(sessionId, { branch: branch.name }).catch((err) => {
      // Detect dirty working tree and show the stash/discard dialog.
      const gitErr = err instanceof GitError ? err : null;
      if (gitErr?.kind === "dirty-working-tree") {
        setDialog({ kind: "dirty-checkout", branch });
      } else {
        reportCheckoutError(err, branch.name);
      }
    });
    doShowHistory(branch);
  };

  const doShowHistory = (branch: EnrichedBranch) => {
    setGitRef("branches", branch.name);
  };

  const archive = (branch: EnrichedBranch) => {
    gitArchiveBranch(repoRoot, branch.name)
      .then(onArchivedChange)
      .catch(() => undefined);
  };

  const openMenu = (e: React.MouseEvent, branch: EnrichedBranch) => {
    e.preventDefault();
    setMenu({ pos: { x: e.clientX, y: e.clientY }, branch });
  };

  const buildMenu = (branch: EnrichedBranch): ContextMenuItem[] => {
    const isPinned = pinnedSet.has(branch.name);
    const isArchived = archivedSet.has(branch.name);

    const items: ContextMenuItem[] = [
      { header: branch.name },
      {
        label: branch.isCurrent ? "Already checked out" : "Checkout",
        onClick: () => {
          setMenu(null);
          doCheckout(branch);
        },
        disabled: branch.isCurrent,
      },
      {
        label: `Create New Branch from "${branch.name}"…`,
        onClick: () => {
          setMenu(null);
          setDialog({ kind: "new-branch-from-drop", startPoint: branch.name });
        },
      },
      {
        label: "Merge into current",
        onClick: () => {
          setMenu(null);
          const currentName = visible.find((b) => b.isCurrent)?.name ?? "HEAD";
          gitMergeBranch(sessionId, {
            from: branch.name,
            into: currentName,
          }).catch((err) => pushError(errorMessage(err), "Merge branch"));
        },
        disabled: branch.isCurrent,
      },
      {
        label: "Rebase onto current",
        onClick: () => {
          setMenu(null);
          gitRebaseOnto(sessionId, { upstream: branch.name }).catch((err) =>
            pushError(errorMessage(err), "Rebase onto"),
          );
        },
        disabled: branch.isCurrent,
      },
      {
        label: "Squash-merge into current",
        onClick: () => {
          setMenu(null);
          const currentName = visible.find((b) => b.isCurrent)?.name ?? "HEAD";
          gitMergeBranch(sessionId, {
            from: branch.name,
            into: currentName,
            squash: true,
          }).catch((err) =>
            pushError(errorMessage(err), "Squash-merge branch"),
          );
        },
        disabled: branch.isCurrent,
      },
      {
        label: "Compare against current",
        onClick: () => {
          setMenu(null);
          const currentName = visible.find((b) => b.isCurrent)?.name ?? "HEAD";
          setGitCompareView(currentName, branch.name);
        },
        disabled: branch.isCurrent,
      },
      { separator: true },
      {
        label: branch.upstream ? "Push…" : "Publish branch…",
        onClick: () => {
          setMenu(null);
          setDialog({ kind: "push", branch });
        },
      },
      {
        label: "Set upstream…",
        onClick: () => {
          setMenu(null);
          setDialog({ kind: "upstream", branch });
        },
      },
      {
        label: "Set as base branch",
        onClick: () => {
          setMenu(null);
          setSessionBaseBranch(sessionId, branch.name).catch((err) =>
            pushError(errorMessage(err), "Set base branch"),
          );
        },
      },
      { separator: true },
      {
        label: isPinned ? "Unpin Branch" : "Pin Branch",
        onClick: () => {
          setMenu(null);
          if (isPinned) {
            gitUnpinBranch(repoRoot, branch.name)
              .then(onPinnedChange)
              .catch(() => undefined);
          } else {
            gitPinBranch(repoRoot, branch.name)
              .then(onPinnedChange)
              .catch(() => undefined);
          }
        },
      },
      { separator: true },
      {
        label: "Delete Branch",
        danger: true,
        disabled: branch.isCurrent,
        onClick: () => {
          setMenu(null);
          setDialog({ kind: "delete", branch });
        },
      },
      { separator: true },
      {
        label: isArchived ? "Unarchive Branch" : "Archive Branch",
        onClick: () => {
          setMenu(null);
          if (isArchived) {
            gitUnarchiveBranch(repoRoot, branch.name)
              .then(onArchivedChange)
              .catch(() => undefined);
          } else {
            archive(branch);
          }
        },
        disabled: branch.isCurrent,
      },
    ];

    // Open PR — detect GitHub remote from upstream.
    if (branch.upstream) {
      items.push({ separator: true });
      items.push({
        label: "Open PR on GitHub",
        onClick: () => {
          setMenu(null);
          // Try to infer GitHub URL from upstream. We use a best-effort guess
          // since we don't have the remote URL readily available here.
          openExternalUrl(
            `https://github.com/compare/${branch.name}?expand=1`,
          ).catch(() => undefined);
        },
      });
    }

    return items;
  };

  return (
    <>
      <CollapsibleSection
        label="Branches"
        collapsed={isCollapsed(collapsed, "branches", false)}
        onToggle={() => toggleCollapsed(collapsed, "branches", false)}
        dropProps={headerDrop}
      >
        {visible.length === 0 && (
          <div className={styles.emptyState}>
            <span className={styles.emptyStateText}>No branches yet</span>
            <Button
              size="sm"
              variant="ghost"
              leading={<Icons.PlusIcon size={11} />}
              onClick={() =>
                setDialog({ kind: "new-branch-from-drop", startPoint: "HEAD" })
              }
            >
              Create branch
            </Button>
          </div>
        )}
        {pinned && (
          <BranchLeaf
            name={pinned.name}
            branch={pinned}
            depth={0}
            pr={prsByBranch.get(pinned.name)}
            isPinned={pinnedSet.has(pinned.name)}
            selected={selectedBranchName === pinned.name}
            onClick={() => doShowHistory(pinned)}
            onContextMenu={(e) => openMenu(e, pinned)}
            onDropBranch={handleBranchDrop}
            onDropCommit={handleCommitDrop}
            onDropRemoteBranch={handleRemoteBranchOnLocal}
          />
        )}
        {tree.map((node) => (
          <BranchTreeNodeView
            key={nodeKey(node)}
            node={node}
            depth={0}
            collapsedMap={collapsed}
            ancestorPaths={ancestorPaths}
            folderKeyPrefix="branch-folder:"
            prsByBranch={prsByBranch}
            pinnedSet={pinnedSet}
            selectedBranchName={selectedBranchName ?? undefined}
            onCheckout={doShowHistory}
            onContextMenu={openMenu}
            onDropBranch={handleBranchDrop}
            onDropCommit={handleCommitDrop}
            onDropRemoteBranch={handleRemoteBranchOnLocal}
          />
        ))}
        {menu && (
          <ContextMenu
            position={menu.pos}
            items={buildMenu(menu.branch)}
            onClose={() => setMenu(null)}
          />
        )}
      </CollapsibleSection>

      {dialog?.kind === "delete" && (
        <DestructiveConfirm
          open
          tone="destructive"
          title="Delete branch?"
          description={`Delete the local branch "${dialog.branch.name}"? This cannot be undone.`}
          confirmLabel="Delete branch"
          onConfirm={() => {
            const target = dialog.branch;
            setDialog(null);
            gitDeleteBranch(sessionId, {
              name: target.name,
              force: true,
            }).catch((err) => pushError(errorMessage(err), "Delete branch"));
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "dirty-checkout" && (
        <DirtyCheckoutDialog
          branch={dialog.branch.name}
          onStash={() => {
            const branch = dialog.branch;
            setDialog(null);
            gitStashAndCheckout(sessionId, branch.name)
              .then(() => onViewChange("history"))
              .catch((err) => pushError(errorMessage(err), "Stash & switch"));
          }}
          onDiscard={() => {
            const branch = dialog.branch;
            setDialog(null);
            gitDiscardAndCheckout(sessionId, branch.name)
              .then(() => onViewChange("history"))
              .catch((err) => pushError(errorMessage(err), "Discard & switch"));
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "upstream" && (
        <UpstreamDialog
          branch={dialog.branch.name}
          defaultValue={dialog.branch.upstream ?? ""}
          onSubmit={(upstream) => {
            const branch = dialog.branch;
            setDialog(null);
            gitSetUpstream(sessionId, {
              branch: branch.name,
              upstream,
            }).catch((err) => pushError(errorMessage(err), "Set upstream"));
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "push" && (
        <PushDialog
          open
          currentBranch={dialog.branch.name}
          hasUpstream={Boolean(dialog.branch.upstream)}
          onConfirm={(r: PushDialogResult) => {
            setDialog(null);
            gitPushV2(sessionId, {
              remote: r.remote,
              branch: r.branch,
              forceWithLease: r.forceWithLease,
              setUpstream: r.setUpstream,
              tags: r.tags,
              ref: r.ref,
            }).catch((err) => pushError(errorMessage(err), "Push branch"));
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "new-branch-from-drop" && (
        <BranchDialog
          open
          currentBranch={visible.find((b) => b.isCurrent)?.name ?? "HEAD"}
          defaultStartPoint={dialog.startPoint}
          branchOptions={visible.map((b) => b.name)}
          onConfirm={(result: BranchDialogResult) => {
            setDialog(null);
            gitCreateBranch(sessionId, {
              name: result.name,
              startPoint: result.startPoint,
              checkout: result.switchTo,
            })
              .then(() => onViewChange("history"))
              .catch((err) => pushError(errorMessage(err), "Create branch"));
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}

interface BranchLeafProps {
  branch: EnrichedBranch;
  depth: number;
  isPinned?: boolean;
  name: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Called when another branch is dropped onto this row (merge/rebase). */
  onDropBranch?: (
    fromBranch: string,
    targetBranch: string,
    altHeld: boolean,
  ) => void;
  /** Called when a commit is dropped onto this row.
   *  - default → cherry-pick
   *  - ⌥ held  → reset
   *  - ⇧ held  → revert */
  onDropCommit?: (
    hash: string,
    targetBranch: string,
    modifier: "cherry-pick" | "reset" | "revert",
  ) => void;
  /** Called when a remote branch is dropped onto this row (pull/merge). */
  onDropRemoteBranch?: (
    remote: string,
    remoteBranchName: string,
    targetBranch: string,
    altHeld: boolean,
  ) => void;
  pr?: InterestingPullRequest;
  /** Whether this row is the user's current selection (drives History view). */
  selected?: boolean;
}

function BranchLeaf({
  name,
  branch,
  depth,
  pr,
  isPinned,
  selected,
  onClick,
  onContextMenu,
  onDropBranch,
  onDropCommit,
  onDropRemoteBranch,
}: BranchLeafProps) {
  const drag = useDraggable({
    kind: "branch",
    branchName: branch.name,
    isCurrent: branch.isCurrent,
  });

  const drop = useDropTarget<
    | { branchName: string; isCurrent: boolean; kind: "branch" }
    | { branchName: string; kind: "remote-branch"; remote: string }
    | { hash: string; kind: "commit"; subject: string }
  >({
    accepts: ["branch", "commit", "remote-branch"],
    label: (payload) => {
      if (payload.kind === "branch") {
        return `Merge ${payload.branchName} into ${name}`;
      }
      if (payload.kind === "commit") {
        return `Cherry-pick onto ${name}`;
      }

      return `Pull ${name} from ${payload.remote}`;
    },
    modifiers: {
      alt: {
        label: (payload) => {
          if (payload.kind === "branch") {
            return `Rebase ${payload.branchName} onto ${name}`;
          }
          if (payload.kind === "commit") {
            return `Reset ${name} to commit`;
          }

          return `Merge ${name} from ${payload.remote}`;
        },
        onDrop: (payload) => handleDrop(payload, "alt"),
      },
      shift: {
        label: (payload) => {
          if (payload.kind === "commit") {
            return `Revert commit on ${name}`;
          }
          // Shift has no defined behavior for branch / remote-branch payloads;
          // fall back to the default label.
          if (payload.kind === "branch") {
            return `Merge ${payload.branchName} into ${name}`;
          }

          return `Pull ${name} from ${payload.remote}`;
        },
        onDrop: (payload) => handleDrop(payload, "shift"),
      },
    },
    onDrop: (payload) => handleDrop(payload, "default"),
  });

  function handleDrop(
    payload:
      | { branchName: string; isCurrent: boolean; kind: "branch" }
      | { branchName: string; kind: "remote-branch"; remote: string }
      | { hash: string; kind: "commit"; subject: string },
    modifier: "alt" | "default" | "shift",
  ) {
    const altHeld = modifier === "alt";
    if (payload.kind === "branch") {
      if (payload.branchName !== branch.name && onDropBranch) {
        onDropBranch(payload.branchName, branch.name, altHeld);
      }
    } else if (payload.kind === "commit") {
      const commitMod = (() => {
        if (modifier === "alt") {
          return "reset";
        }
        if (modifier === "shift") {
          return "revert";
        }

        return "cherry-pick";
      })();
      onDropCommit?.(payload.hash, branch.name, commitMod);
    } else {
      onDropRemoteBranch?.(
        payload.remote,
        payload.branchName,
        branch.name,
        altHeld,
      );
    }
  }

  const { isOver, onDragEnter, onDragLeave, onDragOver, onDrop } = drop;

  const rowClass = [isOver ? styles.branchRowOver : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <SidebarBranchRow
      {...drag}
      name={name}
      title={branch.name}
      current={branch.isCurrent}
      selected={selected}
      ahead={branch.ahead}
      behind={branch.behind}
      prNumber={pr?.number}
      depth={depth}
      className={rowClass}
      trailing={
        isPinned ? (
          <span className={styles.pinIndicator} title="Pinned">
            <Icons.PinIcon size={9} />
          </span>
        ) : undefined
      }
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    />
  );
}

interface BranchTreeNodeViewProps {
  ancestorPaths: Set<string>;
  collapsedMap: Record<string, boolean>;
  depth: number;
  folderKeyPrefix: string;
  node: BranchTreeNode;
  onCheckout: (branch: EnrichedBranch) => void;
  onContextMenu: (e: React.MouseEvent, branch: EnrichedBranch) => void;
  onDropBranch?: (
    fromBranch: string,
    targetBranch: string,
    altHeld: boolean,
  ) => void;
  onDropCommit?: (
    hash: string,
    targetBranch: string,
    modifier: "cherry-pick" | "reset" | "revert",
  ) => void;
  onDropRemoteBranch?: (
    remote: string,
    remoteBranchName: string,
    targetBranch: string,
    altHeld: boolean,
  ) => void;
  pinnedSet: Set<string>;
  prsByBranch: Map<string, InterestingPullRequest>;
  /** Branch name driving the user's current selection (highlighted row). */
  selectedBranchName?: string;
}

function BranchTreeNodeView({
  node,
  depth,
  collapsedMap,
  ancestorPaths,
  folderKeyPrefix,
  prsByBranch,
  pinnedSet,
  selectedBranchName,
  onCheckout,
  onContextMenu,
  onDropBranch,
  onDropCommit,
  onDropRemoteBranch,
}: BranchTreeNodeViewProps) {
  if (node.kind === "leaf") {
    return (
      <BranchLeaf
        name={node.name}
        branch={node.branch}
        depth={depth}
        pr={prsByBranch.get(node.fullName)}
        isPinned={pinnedSet.has(node.branch.name)}
        selected={selectedBranchName === node.branch.name}
        onClick={() => onCheckout(node.branch)}
        onContextMenu={(e) => onContextMenu(e, node.branch)}
        onDropBranch={onDropBranch}
        onDropCommit={onDropCommit}
        onDropRemoteBranch={onDropRemoteBranch}
      />
    );
  }

  const key = `${folderKeyPrefix}${node.path}`;
  // Folders default-collapse, except if they're an ancestor of the current
  // branch — then default-open. The auto-expand-on-checkout effect in
  // BranchesSection clears stored collapse state for these on HEAD change,
  // so a previously-collapsed folder containing the new HEAD reveals itself.
  const defaultCollapsed = !ancestorPaths.has(node.path);
  const folderCollapsed = isCollapsed(collapsedMap, key, defaultCollapsed);

  return (
    <>
      <SidebarBranchFolder
        name={node.name}
        depth={depth}
        collapsed={folderCollapsed}
        onClick={() => toggleCollapsed(collapsedMap, key, defaultCollapsed)}
      />
      {!folderCollapsed &&
        node.children.map((child) => (
          <BranchTreeNodeView
            key={nodeKey(child)}
            node={child}
            depth={depth + 1}
            collapsedMap={collapsedMap}
            ancestorPaths={ancestorPaths}
            folderKeyPrefix={folderKeyPrefix}
            prsByBranch={prsByBranch}
            pinnedSet={pinnedSet}
            selectedBranchName={selectedBranchName}
            onCheckout={onCheckout}
            onContextMenu={onContextMenu}
            onDropBranch={onDropBranch}
            onDropCommit={onDropCommit}
            onDropRemoteBranch={onDropRemoteBranch}
          />
        ))}
    </>
  );
}

function nodeKey(node: BranchTreeNode): string {
  return node.kind === "folder" ? `f:${node.path}` : `l:${node.fullName}`;
}

/* ── Pinned Branches ─────────────────────────────────────────────────── */

export interface PinnedBranchesSectionProps extends RefSectionProps {
  branches: EnrichedBranch[];
  onPinnedChange: (next: string[]) => void;
  pinnedBranches: string[];
}

export function PinnedBranchesSection({
  branches,
  pinnedBranches,
  onPinnedChange,
  sessionId,
  repoRoot,
}: PinnedBranchesSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();
  const prsByBranch = usePrsByBranch(repoRoot);
  const routeGitView = useRouteGitView();
  const routeGitRefName = useRouteGitRefName();
  const selectedBranchName =
    routeGitView === "branches" ? routeGitRefName : null;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [newBranchStart, setNewBranchStart] = useState<string | null>(null);

  if (pinnedBranches.length === 0) {
    return null;
  }

  const pinnedSet = new Set(pinnedBranches);
  const knownNames = new Set(branches.map((b) => b.name));

  // Show only branches that exist in git (ghosts are silently omitted).
  const pinnedItems = pinnedBranches
    .filter((name) => knownNames.has(name))
    .map((name) => branches.find((b) => b.name === name)!)
    .filter(Boolean);

  const doShowHistory = (branch: EnrichedBranch) => {
    setGitRef("branches", branch.name);
  };

  const doCheckout = (branch: EnrichedBranch) => {
    if (branch.isCurrent) {
      doShowHistory(branch);

      return;
    }
    gitCheckout(sessionId, { branch: branch.name }).catch((err) =>
      reportCheckoutError(err, branch.name),
    );
    doShowHistory(branch);
  };

  const openMenu = (e: React.MouseEvent, branch: EnrichedBranch) => {
    e.preventDefault();
    setMenu({ pos: { x: e.clientX, y: e.clientY }, branch });
  };

  return (
    <CollapsibleSection
      label="Pinned"
      collapsed={isCollapsed(collapsed, "pinned-branches", false)}
      onToggle={() => toggleCollapsed(collapsed, "pinned-branches", false)}
    >
      {pinnedItems.map((branch) => (
        <BranchLeaf
          key={branch.name}
          name={branch.name.split("/").at(-1) ?? branch.name}
          branch={branch}
          depth={0}
          pr={prsByBranch.get(branch.name)}
          isPinned
          selected={selectedBranchName === branch.name}
          onClick={() => doShowHistory(branch)}
          onContextMenu={(e) => openMenu(e, branch)}
        />
      ))}
      {menu && (
        <ContextMenu
          position={menu.pos}
          items={[
            { header: menu.branch.name },
            {
              label: menu.branch.isCurrent ? "Already checked out" : "Checkout",
              onClick: () => {
                setMenu(null);
                doCheckout(menu.branch);
              },
              disabled: menu.branch.isCurrent,
            },
            {
              label: `Create New Branch from "${menu.branch.name}"…`,
              onClick: () => {
                const start = menu.branch.name;
                setMenu(null);
                setNewBranchStart(start);
              },
            },
            { separator: true },
            {
              label: pinnedSet.has(menu.branch.name)
                ? "Unpin Branch"
                : "Pin Branch",
              onClick: () => {
                const branch = menu.branch;
                setMenu(null);
                if (pinnedSet.has(branch.name)) {
                  gitUnpinBranch(repoRoot, branch.name)
                    .then(onPinnedChange)
                    .catch(() => undefined);
                } else {
                  gitPinBranch(repoRoot, branch.name)
                    .then(onPinnedChange)
                    .catch(() => undefined);
                }
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {newBranchStart !== null && (
        <BranchDialog
          open
          currentBranch={
            pinnedItems.find((b) => b.isCurrent)?.name ??
            branches.find((b) => b.isCurrent)?.name ??
            "HEAD"
          }
          defaultStartPoint={newBranchStart}
          branchOptions={branches.map((b) => b.name)}
          onConfirm={(result: BranchDialogResult) => {
            setNewBranchStart(null);
            gitCreateBranch(sessionId, {
              name: result.name,
              startPoint: result.startPoint,
              checkout: result.switchTo,
            }).catch((err) => pushError(errorMessage(err), "Create branch"));
          }}
          onCancel={() => setNewBranchStart(null)}
        />
      )}
    </CollapsibleSection>
  );
}

/* ── Archived Branches ───────────────────────────────────────────────── */

export interface ArchivedBranchesSectionProps extends RefSectionProps {
  archivedBranches: string[];
  branches: EnrichedBranch[];
  onArchivedChange: (next: string[]) => void;
}

export function ArchivedBranchesSection({
  branches,
  archivedBranches,
  onArchivedChange,
  repoRoot,
  sessionId,
}: ArchivedBranchesSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();
  const prsByBranch = usePrsByBranch(repoRoot);
  const routeGitView = useRouteGitView();
  const routeGitRefName = useRouteGitRefName();
  const selectedBranchName =
    routeGitView === "branches" ? routeGitRefName : null;
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  if (archivedBranches.length === 0) {
    return null;
  }

  const archivedSet = new Set(archivedBranches);
  const items = branches.filter((b) => archivedSet.has(b.name));
  const knownNames = new Set(branches.map((b) => b.name));
  const ghosts = archivedBranches.filter((n) => !knownNames.has(n));

  const showHistory = (branch: EnrichedBranch) => {
    setGitRef("branches", branch.name);
  };

  const checkout = (branch: EnrichedBranch) => {
    gitCheckout(sessionId, { branch: branch.name }).catch((err) =>
      reportCheckoutError(err, branch.name),
    );
    setGitRef("branches", branch.name);
  };

  const unarchive = (name: string) => {
    gitUnarchiveBranch(repoRoot, name)
      .then(onArchivedChange)
      .catch(() => undefined);
  };

  return (
    <CollapsibleSection
      label="Archived Branches"
      collapsed={isCollapsed(collapsed, "archived-branches", true)}
      onToggle={() => toggleCollapsed(collapsed, "archived-branches", true)}
    >
      {items.map((b) => (
        <SidebarBranchRow
          key={b.name}
          name={b.name.split("/").at(-1) ?? b.name}
          title={b.name}
          ahead={b.ahead}
          behind={b.behind}
          prNumber={prsByBranch.get(b.name)?.number}
          selected={selectedBranchName === b.name}
          className={styles.archivedRow}
          onClick={() => showHistory(b)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ pos: { x: e.clientX, y: e.clientY }, branch: b });
          }}
        />
      ))}
      {ghosts.map((n) => (
        <button
          key={n}
          type="button"
          className={`${styles.refRow} ${styles.archivedGhost}`}
          onClick={() => unarchive(n)}
          title="Branch no longer exists — click to remove from archive"
        >
          <span className={styles.refLabel}>{n}</span>
          <span className={styles.ghostHint}>missing — click to drop</span>
        </button>
      ))}
      {menu && (
        <ContextMenu
          position={menu.pos}
          items={[
            { header: menu.branch.name },
            {
              label: "Checkout",
              onClick: () => {
                setMenu(null);
                checkout(menu.branch);
              },
              disabled: menu.branch.isCurrent,
            },
            { separator: true },
            {
              label: "Unarchive Branch",
              onClick: () => {
                setMenu(null);
                unarchive(menu.branch.name);
              },
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </CollapsibleSection>
  );
}

/* ── Tags ────────────────────────────────────────────────────────────── */

export interface TagsSectionProps extends RefSectionProps {
  /** Extra tag names to float to the top of the list. */
  priorityTagNames?: readonly string[];
  tags: GitTag[];
}

export function TagsSection({ tags, priorityTagNames }: TagsSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();
  const routeGitView = useRouteGitView();
  const routeGitRefName = useRouteGitRefName();
  const selectedTagName = routeGitView === "tags" ? routeGitRefName : null;

  const showTagInHistory = (tagName: string) => {
    setGitRef("tags", tagName);
  };

  // Tags use slash-prefixed naming (e.g. `photos/2025.1.0/...`) so they
  // benefit from the same folder-tree rendering as branches. Synthesize
  // EnrichedBranch-shaped values to reuse `buildLocalTree`.
  const synthetic = tags.map(
    (t): EnrichedBranch => ({
      ahead: 0,
      behind: 0,
      fullName: t.name,
      isCurrent: false,
      lastCommit: null,
      name: t.name,
      upstream: null,
    }),
  );
  // Sort tag leaves by creation date descending (newest first). Folders still
  // sort alphabetically — versioned tag families like `photos/2025.1.0/…`
  // benefit from a stable, predictable folder order.
  const tagDates = new Map(tags.map((t) => [t.name, t.creatorDate]));
  const tree = buildLocalTree(synthetic, priorityTagNames, (a, b) => {
    const da = tagDates.get(a.fullName) ?? "";
    const db = tagDates.get(b.fullName) ?? "";
    if (da === db) {
      return a.name.localeCompare(b.name);
    }

    return db.localeCompare(da);
  });

  return (
    <CollapsibleSection
      label="Tags"
      collapsed={isCollapsed(collapsed, "tags", true)}
      onToggle={() => toggleCollapsed(collapsed, "tags", true)}
    >
      {tags.length === 0 && <span className={styles.emptyHint}>No tags</span>}
      {tree.map((node) => (
        <RefTreeNode
          key={nodeKey(node)}
          node={node}
          depth={0}
          collapsedMap={collapsed}
          folderKeyPrefix="tag-folder:"
          leadingIcon={<Icons.BranchIcon size={11} />}
          onLeafClick={showTagInHistory}
          dragSource={{ kind: "tag" }}
          selectedRefName={selectedTagName}
        />
      ))}
    </CollapsibleSection>
  );
}

/* ── Remotes ─────────────────────────────────────────────────────────── */

export interface RemotesSectionProps extends RefSectionProps {
  remoteBranches: RemoteBranch[];
}

export function RemotesSection({
  remoteBranches,
  sessionId,
}: RemotesSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();
  const routeGitView = useRouteGitView();
  const routeGitRefName = useRouteGitRefName();
  // Remote branches share the `branches` route space — their full ref name
  // (e.g. `origin/main`) goes in `gitRefName` so the history view filters
  // exactly that ref. Local branches won't collide because their names don't
  // include a remote prefix.
  const selectedRefName = routeGitView === "branches" ? routeGitRefName : null;
  // Drop a local branch onto a remote folder/header to push it (with ⌥ for
  // force-with-lease). Hook called once at top of the component; we pass the
  // remote name into the handler at drop time so the same target can wrap
  // single-remote and per-remote group headers without re-calling the hook.
  const pushBranchTo = (
    remote: string,
    branchName: string,
    altHeld: boolean,
  ) => {
    gitPushV2(sessionId, {
      remote,
      branch: branchName,
      setUpstream: true,
      forceWithLease: altHeld,
    }).catch((err) => pushError(errorMessage(err), "Push branch"));
  };

  // Group by remote name so we can keep separation when the user has more
  // than one (origin + upstream + …). For the common single-remote case
  // (just `origin`) we flatten the remote-name folder out — its name adds
  // no information and just costs a click.
  // Drop malformed entries (stray `refs/remotes/<remote>` symbolic pointers
  // with no branch suffix) so they don't show up as a phantom remote group.
  const realBranches = remoteBranches.filter(
    (rb) => rb.remote.length > 0 && rb.branchName.length > 0,
  );
  const groups: Record<string, RemoteBranch[]> = {};
  for (const rb of realBranches) {
    if (!groups[rb.remote]) {
      groups[rb.remote] = [];
    }
    groups[rb.remote]!.push(rb);
  }
  const remoteEntries = Object.entries(groups);
  const singleRemote = remoteEntries.length === 1;

  const buildTree = (rbs: RemoteBranch[]) =>
    buildLocalTree(
      rbs.map(
        (rb): EnrichedBranch => ({
          ahead: 0,
          behind: 0,
          fullName: rb.name,
          isCurrent: false,
          lastCommit: rb.lastCommit,
          name: rb.branchName,
          upstream: null,
        }),
      ),
    );

  return (
    <RemotesSectionContent
      remoteEntries={remoteEntries}
      singleRemote={singleRemote}
      collapsed={collapsed}
      buildTree={buildTree}
      pushBranchTo={pushBranchTo}
      selectedRefName={selectedRefName}
    />
  );
}

interface RemotesSectionContentProps {
  buildTree: (rbs: RemoteBranch[]) => BranchTreeNode[];
  collapsed: Record<string, boolean>;
  pushBranchTo: (remote: string, branchName: string, altHeld: boolean) => void;
  remoteEntries: [string, RemoteBranch[]][];
  selectedRefName: string | null;
  singleRemote: boolean;
}

function RemotesSectionContent({
  remoteEntries,
  singleRemote,
  collapsed,
  buildTree,
  pushBranchTo,
  selectedRefName,
}: RemotesSectionContentProps) {
  const singleRemoteName =
    singleRemote && remoteEntries[0] ? remoteEntries[0][0] : null;

  // Drop target on the section header — only used in single-remote mode where
  // there isn't a per-remote folder header to drop onto.
  const sectionHeaderDrop = useDropTarget<{
    branchName: string;
    isCurrent: boolean;
    kind: "branch";
  }>({
    accepts: ["branch"],
    label: (payload) =>
      `Push ${payload.branchName} to ${singleRemoteName ?? "remote"}`,
    modifiers: {
      alt: {
        label: (payload) =>
          `Force-push ${payload.branchName} to ${singleRemoteName ?? "remote"}`,
        onDrop: (payload) => {
          if (singleRemoteName) {
            pushBranchTo(singleRemoteName, payload.branchName, true);
          }
        },
      },
    },
    onDrop: (payload) => {
      if (singleRemoteName) {
        pushBranchTo(singleRemoteName, payload.branchName, false);
      }
    },
  });

  return (
    <CollapsibleSection
      label="Remotes"
      collapsed={isCollapsed(collapsed, "remotes", true)}
      onToggle={() => toggleCollapsed(collapsed, "remotes", true)}
      dropProps={singleRemoteName ? sectionHeaderDrop : undefined}
    >
      {remoteEntries.length === 0 && (
        <span className={styles.emptyHint}>No remotes</span>
      )}
      {singleRemote &&
        remoteEntries[0] &&
        buildTree(remoteEntries[0][1]).map((node) => (
          <RefTreeNode
            key={nodeKey(node)}
            node={node}
            depth={0}
            collapsedMap={collapsed}
            folderKeyPrefix="remote-folder:"
            leadingIcon={<Icons.BranchIcon size={11} />}
            onLeafClick={(fullName) => setGitRef("branches", fullName)}
            dragSource={{ kind: "remote-branch", remote: remoteEntries[0][0] }}
            selectedRefName={selectedRefName}
          />
        ))}
      {!singleRemote &&
        remoteEntries.map(([remote, rbs]) => (
          <RemoteGroup
            key={remote}
            remote={remote}
            branches={rbs}
            collapsed={collapsed}
            buildTree={buildTree}
            pushBranchTo={pushBranchTo}
            selectedRefName={selectedRefName}
          />
        ))}
    </CollapsibleSection>
  );
}

interface RemoteGroupProps {
  branches: RemoteBranch[];
  buildTree: (rbs: RemoteBranch[]) => BranchTreeNode[];
  collapsed: Record<string, boolean>;
  pushBranchTo: (remote: string, branchName: string, altHeld: boolean) => void;
  remote: string;
  selectedRefName: string | null;
}

function RemoteGroup({
  remote,
  branches,
  collapsed,
  buildTree,
  pushBranchTo,
  selectedRefName,
}: RemoteGroupProps) {
  const remoteKey = `remote:${remote}`;
  const remoteCollapsed = isCollapsed(collapsed, remoteKey, true);
  const tree = buildTree(branches);
  const {
    isOver,
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  } = useDropTarget<{
    branchName: string;
    isCurrent: boolean;
    kind: "branch";
  }>({
    accepts: ["branch"],
    label: (payload) => `Push ${payload.branchName} to ${remote}`,
    modifiers: {
      alt: {
        label: (payload) => `Force-push ${payload.branchName} to ${remote}`,
        onDrop: (payload) => pushBranchTo(remote, payload.branchName, true),
      },
    },
    onDrop: (payload) => pushBranchTo(remote, payload.branchName, false),
  });

  return (
    <div className={styles.remoteGroup}>
      <SidebarBranchFolder
        name={remote}
        depth={0}
        collapsed={remoteCollapsed}
        className={isOver ? styles.remoteFolderOver : undefined}
        onClick={() => toggleCollapsed(collapsed, remoteKey, true)}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {!remoteCollapsed &&
        tree.map((node) => (
          <RefTreeNode
            key={nodeKey(node)}
            node={node}
            depth={1}
            collapsedMap={collapsed}
            folderKeyPrefix={`remote-folder:${remote}/`}
            leadingIcon={<Icons.BranchIcon size={11} />}
            onLeafClick={(fullName) => setGitRef("branches", fullName)}
            dragSource={{ kind: "remote-branch", remote }}
            selectedRefName={selectedRefName}
          />
        ))}
    </div>
  );
}

/* ── Generic ref-tree node (tags + remote subtrees) ──────────────────── */

/** Specifies what kind of drag source each leaf row in the tree should be. */
type RefDragSource =
  | { kind: "remote-branch"; remote: string }
  | { kind: "tag" }
  | undefined;

interface RefTreeNodeProps {
  collapsedMap: Record<string, boolean>;
  depth: number;
  /** Optional drag source descriptor — when set, leaves become draggable. */
  dragSource?: RefDragSource;
  folderKeyPrefix: string;
  leadingIcon: React.ReactNode;
  node: BranchTreeNode;
  onLeafClick: (fullName: string) => void;
  /** Full name of the currently-selected leaf (drives row highlight). */
  selectedRefName?: string | null;
}

function RefTreeNode({
  node,
  depth,
  collapsedMap,
  folderKeyPrefix,
  leadingIcon,
  onLeafClick,
  dragSource,
  selectedRefName,
}: RefTreeNodeProps) {
  if (node.kind === "leaf") {
    return (
      <RefLeaf
        node={node}
        depth={depth}
        leadingIcon={leadingIcon}
        dragSource={dragSource}
        onLeafClick={onLeafClick}
        selected={selectedRefName === node.fullName}
      />
    );
  }
  const key = `${folderKeyPrefix}${node.path}`;
  const folderCollapsed = isCollapsed(collapsedMap, key, true);

  return (
    <>
      <SidebarBranchFolder
        name={node.name}
        depth={depth}
        collapsed={folderCollapsed}
        onClick={() => toggleCollapsed(collapsedMap, key, true)}
      />
      {!folderCollapsed &&
        node.children.map((child) => (
          <RefTreeNode
            key={nodeKey(child)}
            node={child}
            depth={depth + 1}
            collapsedMap={collapsedMap}
            folderKeyPrefix={folderKeyPrefix}
            leadingIcon={leadingIcon}
            onLeafClick={onLeafClick}
            dragSource={dragSource}
            selectedRefName={selectedRefName}
          />
        ))}
    </>
  );
}

interface RefLeafProps {
  depth: number;
  dragSource: RefDragSource;
  leadingIcon: React.ReactNode;
  node: Extract<BranchTreeNode, { kind: "leaf" }>;
  onLeafClick: (fullName: string) => void;
  selected?: boolean;
}

function RefLeaf({
  node,
  depth,
  leadingIcon,
  dragSource,
  onLeafClick,
  selected,
}: RefLeafProps) {
  const tagDrag = useDraggable({
    kind: "tag",
    tagName: node.fullName,
  });
  const remoteBranchDrag = useDraggable({
    kind: "remote-branch",
    branchName: node.branch.name,
    remote: dragSource?.kind === "remote-branch" ? dragSource.remote : "",
  });

  // Only spread drag attrs for the configured drag source kind.
  let dragAttrs: typeof remoteBranchDrag | typeof tagDrag | null = null;
  if (dragSource?.kind === "tag") {
    dragAttrs = tagDrag;
  } else if (dragSource?.kind === "remote-branch") {
    dragAttrs = remoteBranchDrag;
  }

  return (
    <SidebarBranchRow
      {...(dragAttrs ?? {})}
      name={node.name}
      title={node.fullName}
      depth={depth}
      leading={leadingIcon}
      selected={selected}
      onClick={() => onLeafClick(node.fullName)}
    />
  );
}

/* ── Submodules ──────────────────────────────────────────────────────── */

export interface SubmodulesSectionProps extends RefSectionProps {
  submodules: GitSubmodule[];
}

export function SubmodulesSection({
  submodules,
  onViewChange,
}: SubmodulesSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();

  return (
    <CollapsibleSection
      label="Submodules"
      collapsed={isCollapsed(collapsed, "submodules", true)}
      onToggle={() => toggleCollapsed(collapsed, "submodules", true)}
    >
      {submodules.map((sm) => (
        <button
          key={sm.path}
          type="button"
          className={styles.refRow}
          title={sm.path}
          onClick={() => onViewChange("submodules")}
        >
          <span className={styles.refLabel}>{sm.path}</span>
        </button>
      ))}
    </CollapsibleSection>
  );
}

/* ── Worktrees ───────────────────────────────────────────────────────── */

export interface WorktreesSectionProps {
  worktrees: GitWorktree[];
}

export function WorktreesSection({ worktrees }: WorktreesSectionProps) {
  const collapsed = useGitSidebarSectionsCollapsed();

  return (
    <CollapsibleSection
      label="Worktrees"
      collapsed={isCollapsed(collapsed, "worktrees", true)}
      onToggle={() => toggleCollapsed(collapsed, "worktrees", true)}
    >
      {worktrees.length === 0 && (
        <span className={styles.emptyHint}>No worktrees</span>
      )}
      {worktrees.map((w) => (
        <div
          key={w.path}
          className={`${styles.refRow} ${w.isMain ? styles.refRowCurrent : ""}`}
          title={w.path}
        >
          <span className={styles.refLabel}>
            {w.branch ?? w.path.split("/").at(-1) ?? w.path}
          </span>
          {w.isMain && (
            <Badge tone="neutralFilled" size="tag" className={styles.mainBadge}>
              main
            </Badge>
          )}
        </div>
      ))}
    </CollapsibleSection>
  );
}
