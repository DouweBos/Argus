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
Press **⌘/** to open the keyboard shortcut cheatsheet at any time.

---

## Sub-views

The sidebar switches between views with **⌘1**…**⌘6**. Some views are
project-only.

| Shortcut    | View               | Scope            | What it does                                                                   |
| ----------- | ------------------ | ---------------- | ------------------------------------------------------------------------------ |
| **⌘1**      | Working Copy       | session, project | Stage, unstage, discard, commit. Side-by-side or unified diff per file.        |
| **⌘2**      | History            | session, project | Commit graph with lanes, refs, gravatars. Drag-and-drop reorder/squash/revert. |
| **⌘3**      | Stashes            | session, project | List, apply, pop, drop. Save with message and options.                         |
| **⌘4**      | Pull Requests      | project          | GitHub PRs for the repo, with status checks.                                   |
| **⌘4**      | Branch             | session          | Single-branch summary view (the agent's branch).                               |
| **⌘5**      | Branches Review    | project          | Per-branch ahead/behind, last activity, quick checkout.                        |
| **⌘5**      | Conflicts          | session          | Only shown during an in-progress merge/rebase/cherry-pick.                     |
| **⌘6**      | Reflog             | session, project | HEAD reflog with one-click restore.                                            |
| _(sidebar)_ | Tags               | project          | Create, delete, push, checkout. Sorted by date.                                |
| _(sidebar)_ | Remotes            | project          | Add, rename, remove, set URL, prune.                                           |
| _(sidebar)_ | Submodules         | project          | Status, init, update, sync.                                                    |
| _(sidebar)_ | Worktrees          | project          | List, add, remove, prune.                                                      |
| _(sidebar)_ | Bisect             | project          | Start/good/bad/skip with current commit subject inline.                        |
| _(sidebar)_ | Hooks              | project          | View and toggle hooks installed in `.git/hooks`.                               |
| _(sidebar)_ | Interactive rebase | project          | Pick / reword / squash / fixup / drop / edit / reorder commits via drag.       |
| _(sidebar)_ | Settings           | project          | Default branch, pull strategy, LFS, credential helper status.                  |

---

## Working Copy

The working-copy view is the entry point for every commit.

- **Staged / unstaged / untracked** files are shown together with a
  tri-state per file. **Space** toggles staged ↔ unstaged on the focused
  file; **Delete** discards.
- **Hunk staging** with **⌘S** (stage selection) and **⌥⌘S** (unstage
  selection). **⌘D** (or **⇧⌘⌫**) discards the selection.
- **⌘]** / **⌘[** jump to the next / previous hunk; **⌥⌘→** / **⌥⌘←** to
  the next / previous file.
- **⇧⌘E** / **⌥⇧⌘E** stage / unstage everything.
- **⌘R** refreshes the working copy. Argus also watches the repo and
  refreshes automatically.
- **⇧⌘I** toggles a file's `.gitignore` entry.
- **⇧⌘H** opens the file's history in the History view.
- **Diff search** in the toolbar narrows the file list.
- **LFS warning** appears on files that aren't tracked by LFS but should
  be (configurable thresholds in project settings).

### Commit composer

The composer sits below the file list.

- **⌘Enter** commits. **⌥⌘Enter** commits and pushes.
- **⇧⌘C** focuses the subject line from anywhere in the working copy.
- **⇧⌘A** amends the last commit. The composer pre-fills with the
  previous subject and body.
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
- **⌘C** copies the focused commit's hash; **⇧⌘C** copies short hash + subject.
- **Enter** opens the commit detail (full diff, body, parents, refs).
- **⇧⌘H** with a file selected jumps to that file's history.
- The toolbar offers depth presets (last 100 / 500 / all) and exclude
  filters (stashes hidden by default).

---

## Stashes

Save with **⇧⌘S** ("Save stash"); apply the latest with **⌥⇧⌘S**.
**⌘⇧⌥L** opens the "Stash with options…" dialog (include untracked,
keep index, message). Drop a working-copy file onto a stash row to
add it to that stash.

---

## Branches

- **⌘B** opens "New branch…" anywhere in the git view.
- The sidebar lists local, pinned, archived, and remote branches.
  Pinned branches are also shown inline within the main tree so they
  appear in both places.
- Click a branch to open its history; double-click to checkout.
- Right-click for: checkout, rename, delete, push, set upstream, merge
  into current, rebase current onto, compare with current.
- **Project-scope ahead/behind** counts are refreshed in the background
  whenever the working tree changes.
- **Default branches** (`main`, `master`, project-configured) sort to
  the top.

### Renaming the session branch

In session scope, the toolbar offers **Rename branch**. Argus renames
the branch in the worktree and on the remote (if it has an upstream),
and updates the agent's tracked branch name.

---

## Remote operations

The toolbar exposes **Fetch** (**⇧⌘F**), **Pull** (**⇧⌘P**), and
**Push** (**⇧⌘U**) using the configured defaults.

For project scope, **⌥⇧⌘P** ("Pull with options…") and **⌥⇧⌘U** ("Push
with options…") open dialogs that let you pick:

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
view appears automatically (and **⌘5** in session scope opens it). Each
conflicting file shows ours / theirs / merged side-by-side; resolve in
the editor, mark as resolved, and continue or abort the operation from
the toolbar.

---

## Compare

Right-click two refs and choose **Compare** to open the Compare view.
The URL drives the comparison (`?left=…&right=…`), so compare links
survive reloads and can be shared between Argus windows.

---

## Quick Actions

**⇧⌘A** opens Quick Actions — a single fuzzy search over branches,
tags, commits, sub-views, and operations. **⌘L** ("Jump to ref…")
opens the same dialog scoped to refs only.

---

## Project settings (git)

Project-scope **Settings** view exposes git-related project config:

- **Default branch** — what's pinned to the top of the branches list
  and used as the merge target for sessions.
- **Pull strategy** — default for the toolbar pull button.
- **LFS warning thresholds** — file size / extension globs that
  surface the LFS warning in the working copy.
- **Credential helper status** — whether `git config credential.helper`
  is set, with a one-click link to docs if not.

Per-developer git preferences (e.g. default pull strategy override) are
stored in `~/.argus/user-project-settings.json` instead — see
[`app-settings.md`](app-settings.md).

---

## Keyboard shortcuts at a glance

The full registry lives in
`app/components/agent/GitView/shortcuts.ts`. Press **⌘/** in any git
view for the live cheatsheet.

| Combo              | Action                                           |
| ------------------ | ------------------------------------------------ |
| **⌘1**…**⌘6**      | Switch sub-view                                  |
| **⌘\\**            | Toggle git sidebar                               |
| **⌘L**             | Jump to ref…                                     |
| **⇧⌘A**            | Quick Actions… / amend (working copy + composer) |
| **⌘B**             | New branch…                                      |
| **⇧⌘T**            | New tag… (project scope)                         |
| **⌘R**             | Refresh working copy                             |
| **⌘S** / **⌥⌘S**   | Stage / unstage selection                        |
| **⌘D** / **⇧⌘⌫**   | Discard selection                                |
| **⇧⌘E** / **⌥⇧⌘E** | Stage all / unstage all                          |
| **⌘]** / **⌘[**    | Next / previous hunk                             |
| **⌥⌘→** / **⌥⌘←**  | Next / previous file                             |
| **⇧⌘H**            | Show file history                                |
| **⇧⌘I**            | Toggle `.gitignore`                              |
| **⇧⌘F**            | Fetch                                            |
| **⇧⌘P** / **⌥⇧⌘P** | Pull / pull with options…                        |
| **⇧⌘U** / **⌥⇧⌘U** | Push / push with options…                        |
| **⇧⌘S** / **⌥⇧⌘S** | Save / apply latest stash                        |
| **⌘⇧⌥L**           | Stash with options…                              |
| **⌘Enter**         | Commit                                           |
| **⌥⌘Enter**        | Commit & push                                    |
| **⇧⌘C**            | Focus commit subject / copy short hash + subject |
| **⌘C**             | Copy commit hash (history)                       |
| **Enter**          | Open focused commit                              |
| **Space**          | Toggle staged/unstaged on focused file           |
| **Delete**         | Discard focused file                             |
| **⌘/**             | Show keyboard shortcuts                          |
