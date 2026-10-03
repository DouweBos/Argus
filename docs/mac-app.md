# Argus for Mac (beta)

Argus for Mac is a native SwiftUI app that will replace the Electron desktop
app. It runs the same host core — sessions, worktrees, agents, terminals,
simulators — so your projects and sessions carry over, and it reads and writes
the same `~/.argus`.

It is a beta. The Electron app keeps shipping and stays the recommended
desktop until the Mac app reaches parity; the checklist that gates the switch
lives in the repository (`plan/swiftui-parity.md`).

## What works today

- The three-panel window: projects and their sessions, live from the host.
- Creating and deleting sessions, with setup progress.
- Agents in a session as tabs, with their transcript.
- A home for each session: its setup progress (or why it failed), the
  agents working in it, and committing, pushing and merging its branch.
- **Agents** and **Runtimes** in the sidebar: every agent, and every run
  command's process, across all your sessions.
- Terminals under each session (⇧⌘T): tabs, the project's run commands in
  the toolbar, find (⌘F), and links that open on this Mac. A terminal you
  reopen replays what it printed so far.
- Banners for agents that finish or need you, with Approve/Deny buttons on
  permission prompts.
- The runtime panel: each session's simulator, emulator or browser, live, to
  tap, type, scroll and rotate; Simulate, Inspect (the iOS UI inspector) and
  Logs modes; devices in their own floating windows.
- The Devices screen: every simulator and emulator, with boot, shut down and a
  live grid.
- **Git** for each session (the Git tab): the working copy with file, hunk
  and line staging, discard and commit (with amend); the history as a commit
  graph, with each commit's changes and actions (cherry-pick, revert, reset,
  reword, squash, drop, interactive rebase); branches, tags, remotes and
  worktrees; stashes, the reflog, blame, file history, comparing two refs,
  conflict resolution for merges, rebases and cherry-picks, branches review,
  submodules, bisect, hooks and git settings. Fetch, pull, push, new branch,
  stash and tag are in the toolbar, with undo for the last git action.
- **Pull Requests** in the sidebar: the pull requests that need you across
  your projects, each with its conversation, checks and changes, and opening
  a new one for a session's branch.

The app reads your repositories directly with Grove's git engine, so the git
views stay current as agents change files and commit — no refresh needed.
Merging a session into its base branch, pull requests and anything that
follows your project's rules (protected branches, session branch names) still
go through the host, exactly as in the Electron app.

- A first-run walkthrough (welcome, privacy, checking your Mac, a first
  project), a Home screen with cards that fix what's missing, and **Add
  Project…** (⌘O), which can write the project's `.argus.json` for you.
- **Settings** (⌘,): appearance, Claude accounts, agents and automation
  defaults, LLM runners including custom ones, MCP servers, tools, the update
  channel, and remote access — pairing a phone, its grants, push and tunnels.
- **Project Settings** from a project's menu in the sidebar: every
  `.argus.json` field, plus your own branch prefix and worktree locations.
- **Automations**, **Quick Run**, the **Inbox** and its proposals, and
  **Notifications**, the warnings and errors list.
- Hosting a huddle from a session, with guest approval and side chat.
- The command palette (⇧⌘P), and Handoff of the session on screen to your
  phone.

## How it relates to the Electron app

Both apps run the Argus host on the same `~/.argus`, and **only one may run at
a time**: two hosts on the same state would fight over the same worktrees and
agents. Whichever starts first holds the lock (`~/.argus/host.lock`).

- Open Argus for Mac while the Electron app is running and it says so, with a
  button to quit the Electron app and take over.
- Open the Electron app while Argus for Mac is running and it offers the same
  in reverse.

Your phone keeps working with either: the Mac app runs the same remote access
gateway, with the same paired devices.

## Under the hood

The app bundles its own Node runtime and the host
(`Argus.app/Contents/Resources/host/`) and supervises it: it starts the host on
launch, restarts it if it crashes, and stops it — after letting running agents
stop cleanly — when you quit. The host's log is at `~/.argus/logs/host.log`.

The app talks to its host over a Unix socket in `~/.argus` that only your user
can open, rather than over the network.

## Building it

```sh
open clients/apple/ArgusRemote.xcodeproj   # scheme: ArgusDesktop
```

A build phase stages the Node host into the app
(`pnpm build:mac-host --out <dir>`). Debug builds are called **Argus Dev** and
never default to `~/.argus` — they use `~/.argus-mac-dev` unless `ARGUS_HOME`
says otherwise — so a dev build can't collide with the app you use. They are
signed with your Apple Development identity: macOS refuses notifications to an
ad-hoc signed app, and to one run from `/tmp`.
