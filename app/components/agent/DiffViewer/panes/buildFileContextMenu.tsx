import type { PaneKind } from "./FilePane";
import { Icons, type ContextMenuItem } from "@argus/peacock";
import {
  addToGitignore,
  gitMarkResolved,
  revealInFinder,
  stageFile,
  unstageFile,
} from "../../../../lib/ipc";

export interface FileContextMenuArgs {
  conflictPaths: Set<string>;
  onAction: (action: () => Promise<void>) => Promise<void>;
  onDiscard: (paths: string[]) => void;
  onUntrack: (paths: string[]) => void;
  pane: PaneKind;
  paths: string[];
  /** Absolute path of the worktree (used for Reveal / Open in Editor / Open). */
  repoRoot: string;
  sessionId: string;
}

/**
 * Build the right-click menu for one or more rows in either pane.
 * Filters items based on staged/unstaged side and conflict state.
 */
export function buildFileContextMenu({
  pane,
  paths,
  conflictPaths,
  repoRoot,
  sessionId,
  onAction,
  onDiscard,
  onUntrack,
}: FileContextMenuArgs): ContextMenuItem[] {
  const single = paths[0];
  const isUnstaged = pane === "unstaged";
  const hasConflict = paths.some((p) => conflictPaths.has(p));
  const items: ContextMenuItem[] = [];
  const absPath = (p: string) => `${repoRoot.replace(/\/$/, "")}/${p}`;

  if (isUnstaged) {
    items.push({
      icon: <Icons.PlusIcon size={11} />,
      label: paths.length > 1 ? `Stage ${paths.length} files` : "Stage",
      onClick: () =>
        onAction(async () => {
          for (const p of paths) {
            await stageFile(sessionId, p);
          }
        }),
    });
  } else {
    items.push({
      icon: <Icons.MinusIcon size={11} />,
      label: paths.length > 1 ? `Unstage ${paths.length} files` : "Unstage",
      onClick: () =>
        onAction(async () => {
          for (const p of paths) {
            await unstageFile(sessionId, p);
          }
        }),
    });
  }

  // Hunk / line staging affordances are wired in the diff detail; we surface
  // them in the menu so users discover them, but disable when the row isn't
  // in the diff detail's scope (only enabled for a single selection).
  items.push({
    label: "Stage Hunk",
    disabled: true,
    onClick: () => {
      /* handled inline in the diff detail */
    },
  });
  items.push({
    label: "Stage Lines",
    disabled: true,
    onClick: () => {
      /* W6 — handled inline in the diff detail */
    },
  });

  items.push({ separator: true });

  // Discards — three flavours, all behind DestructiveConfirm at the call-site.
  items.push({
    icon: <Icons.TrashIcon size={11} />,
    label: paths.length > 1 ? `Discard ${paths.length} files…` : "Discard…",
    danger: true,
    onClick: () => onDiscard(paths),
  });

  if (hasConflict) {
    items.push({
      icon: <Icons.CheckIcon size={11} />,
      label: "Mark Resolved",
      onClick: () =>
        onAction(async () => {
          for (const p of paths) {
            await gitMarkResolved(sessionId, p);
          }
        }),
    });
  }

  items.push({ separator: true });

  if (single) {
    items.push({
      icon: <Icons.FolderIcon size={11} />,
      label: "Reveal in Finder",
      onClick: () => {
        revealInFinder(absPath(single)).catch(() => {});
      },
    });
    // "Open in Editor" deferred — per-editor wiring lands with H2 of Phase 4
    // (file history opens commits at a path); reveal-in-finder covers the
    // common case in the meantime.
    items.push({
      icon: <Icons.CopyIcon size={11} />,
      label: "Copy Path",
      onClick: () => {
        navigator.clipboard?.writeText(single).catch(() => {});
      },
    });
  }

  items.push({ separator: true });

  if (single) {
    items.push({
      label: "Add to .gitignore",
      onClick: () =>
        onAction(async () => {
          await addToGitignore(sessionId, single);
        }),
    });
  }

  items.push({
    icon: <Icons.TrashIcon size={11} />,
    label:
      paths.length > 1
        ? `Stop Tracking ${paths.length} files…`
        : "Stop Tracking…",
    danger: true,
    onClick: () => onUntrack(paths),
  });

  return items;
}
