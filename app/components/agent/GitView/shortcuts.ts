/**
 * Declarative registry of git keyboard shortcuts.
 *
 * Each entry is metadata only — actual handlers are wired by the consumer
 * via `useGitShortcuts(scope, handlers)`. The registry exists so we have
 * exactly one source of truth for shortcut combos (no more duplicate
 * `useGlobalShortcuts` blocks in `GitView`, `DiffViewer`, `ChangesToolbar`,
 * `CommitPanel`) and so a future `<Cheatsheet />` dialog (phase 3, K5) can
 * generate itself from this list.
 */

export type GitShortcutScope = "project" | "session";

export type GitShortcutContext =
  | "commit-composer"
  | "global"
  | "history"
  | "stashes"
  | "working-copy";

export interface GitShortcut {
  /** Display combo, e.g. "Cmd+1", "Shift+Cmd+E". */
  combo: string;
  /** Contexts within the git view where this shortcut fires. */
  contexts: GitShortcutContext[];
  /** Stable identifier — used as the handler key. */
  id: string;
  /** Human-readable label for cheatsheets and tooltips. */
  label: string;
  /** Parsed combo — derived once at registry build time. */
  matcher: ShortcutMatcher;
  /** Scopes this shortcut is available in. */
  scopes: GitShortcutScope[];
}

export interface ShortcutMatcher {
  alt: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
}

function parseCombo(combo: string): ShortcutMatcher {
  const parts = combo.split("+").map((p) => p.trim());
  const matcher: ShortcutMatcher = {
    key: "",
    meta: false,
    shift: false,
    alt: false,
  };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "cmd" || lower === "meta" || lower === "ctrl") {
      matcher.meta = true;
    } else if (lower === "shift") {
      matcher.shift = true;
    } else if (lower === "opt" || lower === "alt" || lower === "option") {
      matcher.alt = true;
    } else {
      matcher.key = part.length === 1 ? part.toLowerCase() : part;
    }
  }

  return matcher;
}

function shortcut(
  id: string,
  combo: string,
  label: string,
  scopes: GitShortcutScope[],
  contexts: GitShortcutContext[],
): GitShortcut {
  return { id, combo, label, scopes, contexts, matcher: parseCombo(combo) };
}

const ALL_SCOPES: GitShortcutScope[] = ["session", "project"];

/**
 * Phase-0 baseline: the union of currently-wired shortcuts across
 * `GitView`, `DiffViewer`, `ChangesToolbar`, `CommitPanel`. Phase-3 (K1–K5)
 * fills out the rest of spec §6.
 */
export const GIT_SHORTCUTS: readonly GitShortcut[] = [
  // Sub-view switching (GitView).
  shortcut("view-working-copy", "Cmd+1", "Working Copy", ALL_SCOPES, [
    "global",
  ]),
  shortcut("view-history", "Cmd+2", "History", ALL_SCOPES, ["global"]),
  shortcut("view-stashes", "Cmd+3", "Stashes", ALL_SCOPES, ["global"]),
  // Cmd+4 / Cmd+5 are project-only (Pull Requests / Branches Review). For
  // session scope they fall through to the session-only Branch and Conflicts
  // views so the slots aren't dead.
  shortcut(
    "view-pull-requests",
    "Cmd+4",
    "Pull Requests",
    ["project"],
    ["global"],
  ),
  shortcut("view-branch", "Cmd+4", "Branch", ["session"], ["global"]),
  shortcut(
    "view-branches-review",
    "Cmd+5",
    "Branches Review",
    ["project"],
    ["global"],
  ),
  shortcut("view-conflicts", "Cmd+5", "Conflicts", ["session"], ["global"]),
  shortcut("view-reflog", "Cmd+6", "Reflog", ALL_SCOPES, ["global"]),
  shortcut(
    "show-file-history",
    "Cmd+Shift+H",
    "Show file history",
    ALL_SCOPES,
    ["working-copy", "history"],
  ),

  // Working copy
  shortcut("refresh", "Cmd+R", "Refresh working copy", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("stage-all", "Shift+Cmd+E", "Stage all", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("unstage-all", "Opt+Shift+Cmd+E", "Unstage all", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("focus-commit", "Shift+Cmd+C", "Focus commit subject", ALL_SCOPES, [
    "working-copy",
    "commit-composer",
  ]),

  // Remote (ChangesToolbar)
  shortcut("fetch", "Shift+Cmd+F", "Fetch", ALL_SCOPES, ["working-copy"]),
  shortcut("pull", "Shift+Cmd+P", "Pull (tracked)", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("push", "Shift+Cmd+U", "Push", ALL_SCOPES, ["working-copy"]),

  // Stash (ChangesToolbar)
  shortcut("stash-save", "Shift+Cmd+S", "Save stash", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut(
    "stash-apply-latest",
    "Opt+Shift+Cmd+S",
    "Apply latest stash",
    ALL_SCOPES,
    ["working-copy"],
  ),
  shortcut(
    "quick-stash",
    "Cmd+Shift+Opt+L",
    "Stash with options…",
    ALL_SCOPES,
    ["working-copy", "global"],
  ),

  // Phase 2 W12 — commit composer
  shortcut("commit-now", "Cmd+Enter", "Commit", ALL_SCOPES, [
    "commit-composer",
  ]),
  shortcut("commit-and-push", "Opt+Cmd+Enter", "Commit & push", ALL_SCOPES, [
    "commit-composer",
  ]),

  // Phase 3 K1 — working copy stage / unstage / discard / hunk + file nav
  shortcut("stage-selected", "Cmd+S", "Stage selection", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("unstage-selected", "Opt+Cmd+S", "Unstage selection", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("discard-selected", "Cmd+D", "Discard selection", ALL_SCOPES, [
    "working-copy",
  ]),
  // Alias for "Discard local changes in selected file".
  shortcut(
    "discard-selected-alt",
    "Shift+Cmd+Backspace",
    "Discard selection",
    ALL_SCOPES,
    ["working-copy"],
  ),
  shortcut("amend-last", "Shift+Cmd+A", "Amend last commit", ALL_SCOPES, [
    "commit-composer",
    "working-copy",
  ]),
  shortcut("quick-actions", "Shift+Cmd+A", "Quick Actions…", ALL_SCOPES, [
    "global",
  ]),
  shortcut("toggle-ignore", "Shift+Cmd+I", "Toggle .gitignore", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("next-file", "Opt+Cmd+Right", "Next file", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("prev-file", "Opt+Cmd+Left", "Previous file", ALL_SCOPES, [
    "working-copy",
  ]),
  shortcut("next-hunk", "Cmd+]", "Next hunk", ALL_SCOPES, ["working-copy"]),
  shortcut("prev-hunk", "Cmd+[", "Previous hunk", ALL_SCOPES, ["working-copy"]),

  // Phase 3 K2 — remote dialog stubs (Phase 6 P11 fills these in).
  shortcut(
    "pull-with-options",
    "Opt+Shift+Cmd+P",
    "Pull with options…",
    ALL_SCOPES,
    ["global"],
  ),
  shortcut(
    "push-with-options",
    "Opt+Shift+Cmd+U",
    "Push with options…",
    ALL_SCOPES,
    ["global"],
  ),

  // Phase 3 K3 — history
  shortcut("copy-commit-hash", "Cmd+C", "Copy commit hash", ALL_SCOPES, [
    "history",
  ]),
  shortcut(
    "copy-commit-summary",
    "Shift+Cmd+C",
    "Copy short hash + subject",
    ALL_SCOPES,
    ["history"],
  ),
  shortcut("open-commit", "Enter", "Open commit", ALL_SCOPES, ["history"]),

  // Phase 3 K4 — misc
  shortcut("toggle-sidebar", "Cmd+\\", "Toggle git sidebar", ALL_SCOPES, [
    "global",
  ]),
  shortcut("jump-to-ref", "Cmd+L", "Jump to ref…", ALL_SCOPES, ["global"]),
  shortcut("cheatsheet", "Cmd+/", "Show keyboard shortcuts", ALL_SCOPES, [
    "global",
  ]),

  // Tags — Cmd+Shift+T creates a new tag.
  shortcut("new-tag", "Cmd+Shift+T", "New tag…", ["project"], ["global"]),

  // Branches — Cmd+B creates a new branch.
  shortcut("new-branch", "Cmd+B", "New branch…", ALL_SCOPES, ["global"]),

  // Phase 4 — working copy file-list shortcuts
  shortcut(
    "toggle-staged-focused",
    "Space",
    "Toggle staged/unstaged",
    ALL_SCOPES,
    ["working-copy"],
  ),
  shortcut("discard-focused", "Delete", "Discard focused file", ALL_SCOPES, [
    "working-copy",
  ]),
];

export type GitShortcutHandlers = Partial<
  Record<(typeof GIT_SHORTCUTS)[number]["id"], () => void>
>;

export function findShortcut(id: string): GitShortcut | undefined {
  return GIT_SHORTCUTS.find((s) => s.id === id);
}
