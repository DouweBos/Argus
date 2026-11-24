# Git

Argus ships a full git client. It runs in two scopes:

- **Session scope** — opens against a single agent's worktree. Drives the
  agent-review workflow: review what the agent did, stage hunks, commit,
  push, merge.
- **Project scope** — opens against the project root. Full client surface:
  branch graph across all branches, remotes, tags, submodules, worktrees,
  reflog, bisect, hooks, interactive rebase, settings.

Both scopes share Grove's layout: the refs sidebar on the left, a row of
pills across the top that switches between the views, and each view in
rounded cards below it. The session toolbar (refresh, pull, push, sync and
the overflow menu) stays above, and the views Argus and Grove both have
look and work the same in both apps.

---

## Views

The pills show the main views; **More** at the end of the row lists the
rest, and a view opened from More, a menu or a link gets a pill of its own
while it's open. Conflicts gets a pill, with a dot, while a merge, rebase or
cherry-pick needs it. Picking History again on a branch's history shows all
of it. When the row runs out of room the pills drop their titles, except the
selected one.

| View               | Pill or More           | Scope            | What it does                                                                  |
| ------------------ | ---------------------- | ---------------- | ----------------------------------------------------------------------------- |
| Changes            | pill, with a count     | session, project | Stage, unstage, discard, commit; conflicts resolved beside the files.         |
| Branch             | pill                   | session          | The session branch's own commits against its base.                            |
| Timeline           | pill (session), More   | session, project | The agents' turns, each one's diff, and restoring to a turn.                  |
| Guide              | pill                   | session          | An agent-written tour of the branch's changes.                                |
| History            | pill                   | project          | Commit graph with day headers beside the selected commit's changes.           |
| Stashes            | pill                   | session, project | A stash's files over its diff; apply, pop, drop, branch from a stash.         |
| Pull Requests      | pill                   | project          | This project's pull requests that involve you; open a new one.                |
| Branches Review    | pill                   | project          | Merged, stale and active branches, to clean them up.                          |
| Conflicts          | pill while needed      | session, project | Both versions above an editable result, then continue or abort.               |
| Reflog             | More                   | session, project | Where HEAD has been, with each entry's changed files.                         |
| Blame              | More                   | session, project | The file list beside the annotated file, at any revision.                     |
| Bisect             | More                   | project          | Start with a good and a bad ref, mark each commit, land on the first bad one. |
| Hooks              | More                   | project          | The hooks in `.git/hooks`, run by hand with their last output.                |
| Submodules         | More                   | project          | Status, init, update and deinit.                                              |
| Settings           | More                   | project          | Repository config, signing, remotes, Argus's git options and Git LFS.         |
| Compare            | from a ref or a commit | session, project | Two refs' commits and changes; merge or rebase them from the project root.    |
| Interactive rebase | from a commit          | project          | Pick, reword, squash, fixup, drop and reorder commits.                        |

Branches, tags, remotes, worktrees and submodules are in the sidebar.
Bisect, Hooks, Submodules, Settings and Pull Requests share one look: a
card with the view's title and actions at the top.

---

## Working Copy

The working-copy view is the entry point for every commit.

- **Staged / unstaged / untracked** files are shown together with a
  tri-state per file. **Space** toggles staged ↔ unstaged on the focused
  file; **Return** or a double-click opens it. Selected files can be
  stashed on their own.
- **Hunk staging**: stage, unstage or discard a selection.
- Diffs highlight syntax and changed words, wrap long lines, and show
  image and Git LFS changes. Drag along a line to copy part of it.
- When the window is too narrow for two columns, the files sit over the
  diff.
- Argus watches the repo and refreshes the working copy automatically.
- **Diff search** in the toolbar narrows the file list.
- **LFS warning** appears on files that aren't tracked by LFS but should
  be (configurable thresholds in project settings).

### Viewed files

Tick **Viewed** in a diff's header to mark a file reviewed; the list dims
it and counts your progress ("3 of 40 viewed"). If the file changes after
you ticked it, it shows **Changed** until you look again.

- On a pull request's **Files** tab the marks are GitHub's own, so
  github.com shows the same progress (and a push there flips them to
  Changed).
- On a session's diff, for branches with no pull request to hold them, the
  marks are kept on the computer in `~/.argus/viewed-files.json` and go
  away with the session.
- The iPhone shows and sets the same marks on a pull request and on a
  session's Changes.

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
long-lived branches stay visible, grouped under day headers. The selected
commit's changed files sit beside it and open into their diffs; when
History opens, the selected commit is in view with its day's header.

- **Return** or a double-click checks out a commit after asking; **⌘C**
  copies the selected SHAs.
- A file's history offers **Open Blame at This Revision** wherever Blame
  can open.

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

- **⌘B** opens New Branch from anywhere in the session but the code view.
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

### Stacked sessions

Split work into layers by starting a session **on top of** another one:
**New Session on Top of This One** in a session's sidebar menu or its
context card on the Mac, or **New session on top** in a session's menu and
its Stack card on the phone. The new session branches from the other
session's branch, which becomes its base, so its pull request targets that
branch. In the sidebar it sits under its parent, indented.

- **Restack** (any session in the stack) rebases every session above the
  bottom one onto its parent's current tip, parents first. Only each
  session's own commits are replayed, so amending or rebasing a parent
  doesn't bring its old commits back. Sessions with an open pull request
  are force-pushed (with lease) and their pull request is pointed at the
  parent's branch. A conflict stops the restack and leaves the rebase
  paused in that session for the conflict resolver; resolve it, then
  restack again.
- **Land Stack** merges the stack bottom-up with the strategy you pick:
  each session merges its pull request when it has one, or merges locally
  into its base otherwise. Its children then move onto that base, their
  pull requests are retargeted, and landing carries on with them. It stops
  at the first conflict, failing check or blocked pull request and says
  where.

Pull requests here include GitLab merge requests: Restack retargets and
Land Stack merges them the same way.

A compare run's slots can't be stacked on: keep one of them first.

Deleting a session in the middle of a stack moves its children down onto
its base.

### Renaming the session branch

In session scope, the toolbar offers **Rename branch**. Argus renames
the branch in the worktree and on the remote (if it has an upstream),
and updates the agent's tracked branch name.

---

## Remote operations

The toolbar and the Git menu expose **Fetch** (**⇧⌘F**), **Pull**
(**⇧⌘P**) and **Push** (**⇧⌘U**).

**Pull** and **Push** in the Git menu open dialogs that let you pick:

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
pill appears with a dot. Each conflicting file shows both versions above
an editable result, right beside your files; resolve it, mark it resolved,
and continue or abort the operation. On a paired computer saving is off
while the file can't be read, so it can never be emptied.

Merging a session into its base checks for conflicts first. If any file
would conflict, Argus lists them and offers **Rebase with an Agent**: an
agent starts in the session, rebases it onto the base, resolves the
conflicts and runs the tests. It doesn't merge or push; you merge once
it's done. The phone offers the same from a session's changes.

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

The Git menu lists them, and greys out what the session can't do with the
reason under it. Pressing such a key says why instead of doing nothing.

| Combo   | Action                                                | Works                                       |
| ------- | ----------------------------------------------------- | ------------------------------------------- |
| **⇧⌘U** | Push                                                  | Anywhere in a session                       |
| **⇧⌘R** | Rebase                                                | Anywhere in a session                       |
| **⇧⌘S** | Stash                                                 | Anywhere in a session                       |
| **⇧⌘F** | Fetch                                                 | In a session, except Code (Find in Files)   |
| **⌘B**  | New branch (in a worktree session, rename its branch) | In a session, except Code (navigator)       |
| **⇧⌘M** | Merge                                                 | In a session, except Code (problems)        |
| **⇧⌘P** | Pull                                                  | Git view, or the Diff tab while it's in use |
| **⌘↩**  | Commit                                                | Git view, or the Diff tab while it's in use |
| **⌥⌘S** | Save a snapshot: a stash that leaves the changes      | Git view, or the Diff tab while it's in use |
| **⌥⌘Z** | Undo the last git action                              | Git view, or the Diff tab while it's in use |

Merge and Rebase need the project root, as the host only runs them there.
A key yields to sheets, other windows and text still being composed, and ⌘↩
to whatever editor, composer or comment box you're typing in.
