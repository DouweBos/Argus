/**
 * Right-click menu for a commit row. Includes Reset (Soft/Mixed/Hard),
 * Revert, Cherry-pick, Create branch, Create tag, Copy SHA, and the
 * interactive-rebase entries (Drop, Squash with previous, Reword, Edit).
 * Available in both project and session scope.
 */

import type { GitCommit } from "../../../lib/ipc";
import { ContextMenu, Icons, type ContextMenuItem } from "@argus/peacock";
import { commitUrl, parseGitHubRemote } from "../../../lib/github";

export type RebaseSingleAction = "drop" | "edit" | "reword" | "squash";

export interface CommitContextMenuProps {
  commit: GitCommit;
  /** Phase 6B P12 — cherry-picks the commit onto the current branch. */
  onCherryPick?: (commit: GitCommit) => void;
  onClose: () => void;
  onCompareWithHead: (hash: string) => void;
  /** Phase 3 — opens the branch-create dialog with this commit as start point. */
  onCreateBranch?: (commit: GitCommit) => void;
  /** Phase 3 — opens the tag-create dialog with this commit as the target ref. */
  onCreateTag?: (commit: GitCommit) => void;
  /** Removes the commit from history via interactive rebase drop. */
  onDelete?: (commit: GitCommit) => void;
  /** Phase 7 T2 — opens the rebase editor pre-filled with the chosen action. */
  onInteractiveRebase?: (commit: GitCommit, action: RebaseSingleAction) => void;
  /** Phase 12 — navigate to the standalone interactive-rebase view from this commit. */
  onInteractiveRebaseFromHere?: (commit: GitCommit) => void;
  onResetHard?: (commit: GitCommit) => void;
  /** Phase 6B P12 — opens the reset dialog with this commit as target. */
  onResetHere?: (commit: GitCommit) => void;
  onResetMixed?: (commit: GitCommit) => void;
  /** Phase 3 — resets HEAD to this commit with the given mode. */
  onResetSoft?: (commit: GitCommit) => void;
  /** Phase 6B P12 — applies the commit's diff as a new commit. */
  onRevert?: (commit: GitCommit) => void;
  /** Squash all selected commits into one. */
  onSquashSelection?: () => void;
  onViewFiles: (hash: string) => void;
  position: { x: number; y: number };
  /** First parseable GitHub remote URL, if any. */
  remoteUrl?: string | null;
  /** Multi-select: number of commits currently selected (>= 2 enables multi mode). */
  selectionCount?: number;
}

function copy(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => undefined);
}

export function CommitContextMenu({
  commit,
  position,
  remoteUrl,
  onClose,
  onViewFiles,
  onCompareWithHead,
  onResetSoft,
  onResetMixed,
  onResetHard,
  onResetHere,
  onRevert,
  onDelete,
  onCherryPick,
  onCreateBranch,
  onCreateTag,
  onInteractiveRebase,
  onInteractiveRebaseFromHere,
  selectionCount = 1,
  onSquashSelection,
}: CommitContextMenuProps) {
  const items: ContextMenuItem[] = [];
  const multi = selectionCount >= 2;

  if (multi) {
    items.push(
      { header: `${selectionCount} commits selected` },
      {
        icon: <Icons.MergeIcon size={11} />,
        label: `Squash ${selectionCount} commits into one`,
        disabled: !onSquashSelection,
        onClick: () => onSquashSelection?.(),
      },
      { separator: true },
    );
  }

  items.push(
    {
      icon: <Icons.CopyIcon size={11} />,
      label: "Copy SHA",
      onClick: () => copy(commit.hash),
    },
    {
      icon: <Icons.CopyIcon size={11} />,
      label: "Copy short SHA",
      onClick: () => copy(commit.abbreviatedHash),
    },
    {
      icon: <Icons.CopyIcon size={11} />,
      label: "Copy subject",
      onClick: () => copy(commit.subject),
    },
    {
      icon: <Icons.CopyIcon size={11} />,
      label: "Copy short SHA + subject",
      onClick: () => copy(`${commit.abbreviatedHash} ${commit.subject}`),
    },
    { separator: true },
    {
      icon: <Icons.FileIcon size={11} />,
      label: "View files",
      onClick: () => onViewFiles(commit.hash),
    },
    {
      icon: <Icons.BranchIcon size={11} />,
      label: "Compare with HEAD",
      onClick: () => onCompareWithHead(commit.hash),
    },
  );

  const gh = remoteUrl ? parseGitHubRemote(remoteUrl) : null;
  if (gh) {
    items.push({
      icon: <Icons.WebIcon size={11} />,
      label: "Open on GitHub",
      onClick: () => {
        const url = commitUrl(gh, commit.hash);
        window.open(url, "_blank");
      },
    });
  }

  // Reset HEAD section — three direct mode entries so the user doesn't need
  // to open a separate dialog when they already know the mode they want.
  items.push(
    { separator: true },
    { header: "Reset HEAD to this commit" },
    {
      icon: <Icons.HistoryIcon size={11} />,
      label: "Soft — keep staged changes",
      disabled: !onResetSoft && !onResetHere,
      onClick: () =>
        onResetSoft ? onResetSoft(commit) : onResetHere?.(commit),
    },
    {
      icon: <Icons.HistoryIcon size={11} />,
      label: "Mixed — keep unstaged changes",
      disabled: !onResetMixed && !onResetHere,
      onClick: () =>
        onResetMixed ? onResetMixed(commit) : onResetHere?.(commit),
    },
    {
      icon: <Icons.WarningIcon size={11} />,
      label: "Hard — discard all changes",
      danger: true,
      disabled: !onResetHard && !onResetHere,
      onClick: () =>
        onResetHard ? onResetHard(commit) : onResetHere?.(commit),
    },
  );

  items.push(
    { separator: true },
    {
      icon: <Icons.BranchIcon size={11} />,
      label: "Revert commit",
      disabled: !onRevert,
      onClick: () => onRevert?.(commit),
    },
    {
      icon: <Icons.BranchIcon size={11} />,
      // TODO: Phase 2 DnD — extend to multi-select once Cmd-click builds a
      // selection set rather than opening the compare view.
      label: "Cherry-pick to current branch",
      disabled: !onCherryPick,
      onClick: () => onCherryPick?.(commit),
    },
    { separator: true },
    {
      icon: <Icons.BranchIcon size={11} />,
      label: `Create New Branch from "${commit.abbreviatedHash}"…`,
      disabled: !onCreateBranch,
      onClick: () => onCreateBranch?.(commit),
    },
    {
      icon: <Icons.TagIcon size={11} />,
      label: "Create tag here…",
      disabled: !onCreateTag,
      onClick: () => onCreateTag?.(commit),
    },
    { separator: true },
    {
      icon: <Icons.HistoryIcon size={11} />,
      label: "Interactive rebase from here",
      disabled: !onInteractiveRebaseFromHere,
      onClick: () => onInteractiveRebaseFromHere?.(commit),
    },
    {
      icon: <Icons.WarningIcon size={11} />,
      label: "Drop",
      disabled: !onInteractiveRebase,
      onClick: () => onInteractiveRebase?.(commit, "drop"),
    },
    {
      icon: <Icons.MergeIcon size={11} />,
      label: "Squash with previous",
      disabled: !onInteractiveRebase,
      onClick: () => onInteractiveRebase?.(commit, "squash"),
    },
    {
      icon: <Icons.PencilIcon size={11} />,
      label: "Reword",
      disabled: !onInteractiveRebase,
      onClick: () => onInteractiveRebase?.(commit, "reword"),
    },
    {
      icon: <Icons.PencilIcon size={11} />,
      label: "Edit (interactive rebase)",
      disabled: !onInteractiveRebase,
      onClick: () => onInteractiveRebase?.(commit, "edit"),
    },
    { separator: true },
    {
      icon: <Icons.TrashIcon size={11} />,
      label: "Delete commit",
      danger: true,
      disabled: !onDelete,
      onClick: () => onDelete?.(commit),
    },
  );

  return <ContextMenu items={items} position={position} onClose={onClose} />;
}
