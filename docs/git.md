# Git

Argus ships a full git client. It runs in two scopes:

- **Session scope** — opens against a single agent's worktree. Drives the
  agent-review workflow: review what the agent did, stage hunks, commit,
  push, merge.
- **Project scope** — opens against the project root. Full client surface:
  branch graph across all branches, remotes, tags, submodules, worktrees,
  reflog, bisect, hooks, interactive rebase, settings.

Both scopes share the same layout: a left sidebar listing refs and
sub-views, the active view in the centre, and a unified toolbar above it.

---

## Sub-views

The sidebar switches between views. Some views are project-only.

| View               | Scope            | What it does                                                                   |
| ------------------ | ---------------- | ------------------------------------------------------------------------------ |
| Working Copy       | session, project | Stage, unstage, discard, commit. Side-by-side or unified diff per file.        |
| History            | session, project | Commit graph with lanes, refs, gravatars. Drag-and-drop reorder/squash/revert. |
| Stashes            | session, project | List, apply, pop, drop. Save with message and options.                         |
| Pull Requests      | project          | GitHub PRs for the repo, with status checks.                                   |
| Branch             | session          | Single-branch summary view (the agent's branch).                               |
| Branches Review    | project          | Per-branch ahead/behind, last activity, quick checkout.                        |
| Conflicts          | session          | Only shown during an in-progress merge/rebase/cherry-pick.                     |
| Reflog             | session, project | HEAD reflog with one-click restore.                                            |
| Tags               | project          | Create, delete, push, checkout. Sorted by date.                                |
| Remotes            | project          | Add, rename, remove, set URL, prune.                                           |
| Submodules         | project          | Status, init, update, sync.                                                    |
| Worktrees          | project          | List, add, remove, prune.                                                      |
| Bisect             | project          | Start/good/bad/skip with current commit subject inline.                        |
| Hooks              | project          | View and toggle hooks installed in `.git/hooks`.                               |
| Interactive rebase | project          | Pick / reword / squash / fixup / drop / edit / reorder commits via drag.       |
| Settings           | project          | Default branch, pull strategy, LFS, credential helper status.                  |

---

## Working Copy

The working-copy view is the entry point for every commit.

- **Staged / unstaged / untracked** files are shown together with a
  tri-state per file. **Space** toggles staged ↔ unstaged on the focused
  file.
- **Hunk staging**: stage, unstage or discard a selection.
- Argus watches the repo and refreshes the working copy automatically.
- **Diff search** in the toolbar narrows the file list.
- **LFS warning** appears on files that aren't tracked by LFS but should
  be (configurable thresholds in project settings).

### Commit composer

The composer sits below the file list.

- **⌘↩** commits.
- **Amend** pre-fills the composer with the previous subject and body.
- Drag a commit from History onto the composer to **revert** it; drag a
  changed file from the working copy onto a commit in History to apply
  that change as a fixup.

---

## History

A graph of the commits reachable from each ref, with lane compaction so
long-lived branches stay visible.

- **Drag-and-drop**: reorder, squash, fixup, revert, cherry-pick. Drop a
  commit onto another to squash, drop onto the working copy to apply,
  drop onto the trash zone to revert.
- **Multi-select** (Cmd-click / Shift-click) for bulk squash.
- Right-click a commit for: checkout, create branch from commit, tag at
  commit, reset to commit, revert, cherry-pick, copy hash, copy summary.
- Opening a commit shows its detail (full diff, body, parents, refs).
- The toolbar offers depth presets (last 100 / 500 / all) and exclude
  filters (stashes hidden by default).

---

## Stashes

Save with **⇧⌘S** (Git → Stash…). Drop a working-copy file onto a stash row to
add it to that stash.

---

## Branches

- **⌘B** opens "New branch…" while the git panel is in front.
- The sidebar lists local, pinned, archived, and remote branches.
  Pinned branches are also shown inline within the main tree so they
  appear in both places.
- Click a branch to open its history; double-click to checkout.
- Right-click for: checkout, rename, delete, push, set upstream, merge
  into current, rebase current onto, compare with current, open a PR on
  GitHub.
- Deleting a branch whose commits aren't on any other branch asks a
  second time before it throws them away.
- **From your phone**, Branches on a project opens the same list. Tap a
  branch to see its history and each commit's diff, compare it with the
  checked-out branch, and — with the `control` grant — switch to it,
  branch from it, merge or squash it in, rebase onto it, push or publish
  it, pull, rename, pin, open a PR or delete it. A merge or rebase that
  stops on conflicts is left for you to resolve on the computer.
- **Project-scope ahead/behind** counts are refreshed in the background
  whenever the working tree changes.
- **Default branches** (`main`, `master`, project-configured) sort to
  the top.

### Landing a session on its base branch

The merge button (in the runtime bar, the changes panel, and the home
screen's "Ready to merge" card) always asks how the session's commits
should land:

- **Keep every commit** — history lands exactly as the agent wrote it.
- **Squash into one commit** — the whole session becomes a single
  conventional commit.

Neither is a default, and nothing is remembered between merges: a squash
rewrites history, so it is only ever done when asked for. From the
command palette the two are separate entries. Either way the base branch
fast-forwards onto the result, so history stays linear.

The base a session merges into is set when the session is created and
can be changed later — on the phone and in the web client from **Land this
work → Base branch → Change**. It must be a local
branch: a remote-tracking ref like `origin/main` cannot be
fast-forwarded, and a session pointed at one is repaired automatically
to the local branch behind it.

### Renaming the session branch

In session scope, the toolbar offers **Rename branch**. Argus renames
the branch in the worktree and on the remote (if it has an upstream),
and updates the agent's tracked branch name.

---

## Remote operations

The toolbar and the Git menu expose **Fetch** (**⇧⌘F**), **Pull…**
(**⇧⌘P**) and **Push…** (**⇧⌘U**).

**Pull…** and **Push…** in the Git menu open dialogs that let you pick:

- **Pull** — strategy (merge / rebase / fast-forward only), prune, tags.
- **Push** — remote, branch, force-with-lease, set upstream, tags, ref.

Errors come back as a typed banner above the active view. The banner
suggests recovery actions for each kind: "no upstream" → publish branch,
"non-fast-forward" → pull then push, "rejected" → force-with-lease (with
a confirm step), and so on.

### Publishing a session branch

If the session branch has no upstream, the toolbar's push button opens a
confirm dialog ("Publish branch?") that pushes to `origin` and sets it
as upstream in one step.

---

## Conflicts

When a merge, rebase, or cherry-pick stops on conflicts, the Conflicts
view appears automatically. Each
conflicting file shows ours / theirs / merged side-by-side; resolve in
the editor, mark as resolved, and continue or abort the operation from
the toolbar.

---

## Compare

Right-click two refs and choose **Compare** to open the Compare view.
The URL drives the comparison (`?left=…&right=…`), so compare links
survive reloads and can be shared between Argus windows.

---

## Project settings (git)

The project's git **Settings** view holds:

- **Branch prefix** — prepended to branches you create through Argus.
- **Auto-fetch** — how often `git fetch --prune` runs in the background,
  shared with the team through `.argus.json`.
- **Suppress LFS banners** — hides the git-lfs warnings above the working copy.
- **Archived branches** — branches you've hidden from the branch list.

Everything but auto-fetch is personal, stored in
`~/.argus/user-project-settings.json` — see
[`app-settings.md`](app-settings.md). Pulls follow the repository's own
`pull.rebase` / `pull.ff` git config.

---

## Keyboard shortcuts at a glance

The Git menu lists them. Keys something else also uses (⇧⌘P, ⇧⌘F, ⌘B, ⇧⌘M,
⌘↩) only apply while the git panel is in front.

| Combo   | Action                                                 |
| ------- | ------------------------------------------------------ |
| **⇧⌘F** | Fetch                                                  |
| **⇧⌘P** | Pull…                                                  |
| **⇧⌘U** | Push…                                                  |
| **⌘B**  | New branch… (in a worktree session, rename its branch) |
| **⇧⌘M** | Merge…                                                 |
| **⇧⌘R** | Rebase…                                                |
| **⌘↩**  | Commit                                                 |
| **⇧⌘S** | Stash…                                                 |
