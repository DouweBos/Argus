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
  A session's Home, Agents and Git views switch from the toolbar, the View
  menu or ⌘1, ⌘2 and ⌘3.
- **Agents** and **Runtimes** in the sidebar: every agent, and every run
  command's process, across all your sessions.
- Terminals under each session (⇧⌘T): tabs, the project's run commands in
  the toolbar, find (⌘F), and links that open on this Mac. A terminal you
  reopen replays what it printed so far.
- Banners for agents that finish or need you, with Approve/Deny buttons on
  permission prompts.
- The runtime panel: each session's simulator, emulator or browser, live, to
  tap, type, scroll and rotate; Simulate, Inspect (the iOS UI inspector) and
  Logs modes; devices in their own floating windows. DevTools for the
  session's browser open in a window of their own.
- The Devices screen: every simulator and emulator, with boot, shut down, a
  live grid, and each device's details with a live picture.
- **Git** for each session (the Git tab): the working copy with file, hunk
  and line staging, discard and commit (with amend); the history as a commit
  graph, with each commit's changes and actions (cherry-pick, revert, reset,
  reword, squash, drop, interactive rebase); branches, tags, remotes and
  worktrees; stashes, the reflog, blame, file history, comparing two refs,
  conflict resolution for merges, rebases and cherry-picks, branches review,
  submodules, bisect, hooks and git settings. Fetch, pull, push, new branch,
  stash and tag are in the toolbar, with undo for the last git action.
  Commit templates, gitmoji, saved identities, Git LFS tracking, creating and
  applying patches and an All Files list are in the working copy; when a git
  command fails, its banner offers the fix (pull then push, a lease-protected
  force push, publishing the branch, resolving conflicts, …).
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
  defaults, LLM runners including custom ones, MCP servers, tools, git
  defaults and commit signing, the update channel, and remote access —
  pairing a phone, its grants, push and tunnels.
- **Project Settings** from a project's menu in the sidebar: every
  `.argus.json` field, plus your own branch prefix and worktree locations.
- **Automations**, **Quick Run**, the **Inbox** and its proposals, and
  **Notifications**, the warnings and errors list.
- Hosting a huddle from a session, with guest approval and side chat.
- The command palette (⇧⌘P), and Handoff of the session on screen to your
  phone.

## Other hosts

Argus for Mac can drive other machines running Argus — another Mac, a
headless Argus server, or `argus-host` — as well as its own:

- **Settings → Hosts** pairs with one: paste the pairing code from that
  machine's Remote screen, compare the 6-digit code, and approve it there with
  **Admin** ticked. Paired hosts can be renamed, attached, detached, shown or
  forgotten.
- Attached hosts' projects sit in the sidebar beside this Mac's, each marked
  with its machine and whether it's connected. The machines menu at the top
  of the sidebar narrows it to one machine and shows that machine on the
  screens that aren't about one session (Home, Devices, Automations, Inbox,
  Settings).
- Window tabs keep machines apart: **Open in New Tab** from the machines menu
  or a session's menu (⌥⌘T for a new tab, ⌃Tab to cycle). Each tab has its
  own back and forward, and the tabs come back when the app restarts.
- **Add Project…** and **Browse…** for worktree locations pick a folder on
  the machine you're looking at, browsing that machine's disk.
- Files dropped on a remote session's chat are sent to its machine first
  (up to 8 MB each).
- Sessions, agents, terminals and the runtime panel of a remote project run
  on its host; the connection is end-to-end encrypted. Links still open on
  this Mac; Reveal in Finder and Open in editor aren't available for files on
  another machine.
- The git views work on a remote session too: git runs on its host, and the
  views refresh when the host reports a change.
- If a host drops, its agents keep running there. Its projects stay in the
  sidebar marked offline, and the app reconnects and catches up on its own.
  The app remembers each host's last projects and sessions, so one that is
  down when the app starts still shows them, offline.
- Two machines holding a repository at the same path show as two projects,
  each under its own machine.

The keys for paired hosts are kept in a file in the app's state folder that
only your user can read.

## How it relates to the Electron app

Both apps run the Argus host on the same `~/.argus`, and **only one host may
run at a time**: two hosts on the same state would fight over the same
worktrees and agents. Whichever starts first holds the lock
(`~/.argus/host.lock`).

Open Argus for Mac while the Electron app is running and it **opens as a
second window on the Electron app's host** instead of starting its own:

- A badge in the toolbar says **Attached to Argus (Electron)**. Both windows
  show the same projects, sessions and agents, live. A message sent from
  either lands once, and a permission prompt answered in one disappears from
  the other.
- What's on screen stays per window: the agent you have open, where you've
  scrolled, what you're typing.
- Settings changed in one window show up in the other right away; if both
  change the same one, the last change wins. Attaching never copies Argus for
  Mac's own settings over the Electron app's.
- The Electron app stays in charge of banners: you get one per event, not one
  per window. Links and files you open from Argus for Mac open from it.
- Quitting Argus for Mac leaves the agents running. Quitting the Electron app
  stops them, and Argus for Mac says so; it reconnects by itself when the
  Electron app opens again, or **Start Argus Here** runs its own host instead.
- To make Argus for Mac the one running the host, pick **Quit Argus (Electron)
  and Take Over…** from the badge. It asks first, since quitting the Electron
  app stops its agents.

Open the Electron app while Argus for Mac is running and it offers to quit
Argus for Mac and take over.

Your phone keeps working with either: the Mac app runs the same remote access
gateway, with the same paired devices.

## Moving from the Electron app

Everything the host keeps carries over by itself: projects, sessions and
their worktrees, chat history, automations, each project's `.argus.json`,
and your settings — appearance, display size, agent defaults, custom
editors, git views, your telemetry choice — along with recent projects,
the device each session last used and the Devices view.

1. **Update the Electron app and open it once.** It moves your paired
   devices and MCP sign-ins to the keychain format both apps read, and
   copies the preferences it kept to itself into your Argus home. Nothing
   else changes for it; it keeps working as before. If the move can't
   finish (the keychain refuses, say), the Electron app leaves the files
   exactly as they were, keeps using them in the old format, and tries
   again the next time it opens.
2. **Quit it and open Argus for Mac.** Your phone stays paired, your MCP
   servers stay signed in, and the app opens with your settings.

You can switch back and forth: both apps read and write the same values, so
a change in one shows up in the other the next time it opens.

If you open Argus for Mac before step 1, Home says that your paired devices
or MCP sign-ins are still in the Electron app's format, and remote access
won't start until they're moved: quit Argus for Mac, open the Electron app
once, quit it, and open Argus for Mac again (**Check Again** on the card
confirms it).

What doesn't carry over: window tabs and panel sizes, a few Electron-only
git toggles (word diff, the conventional-commit picker, ignored and
unchanged files, the default pull strategy, "don't ask again" choices), and
the other computers you paired the Electron app with under Settings →
Hosts — pair those again in Argus for Mac.

Encrypted files (`remote-devices.json`, `mcp-tokens.json`) are sealed with a
key in your login keychain, the item "Argus Host Secret Storage" for your
Argus home. Every Argus app reads it through macOS's `security` tool, which
the item trusts, so neither app asks for your keychain password.

## Under the hood

The app bundles its own Node runtime and the host
(`Argus.app/Contents/Resources/host/`) and supervises it: it starts the host on
launch, restarts it if it crashes, and stops it — after letting running agents
stop cleanly — when you quit. The host's log is at `~/.argus/logs/host.log`.

The app talks to its host over a Unix socket in `~/.argus` that only your user
can open, rather than over the network. Every host serves that socket — the
Electron app's, Argus for Mac's and `argus-host` — and names it in
`host.lock`, which is how a second window finds one to attach to.

What the host asks of the windows on that socket:

| Request                                  | Goes to                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Banners, raising the window              | The app running the host (the Electron app, or Argus for Mac when it runs its own); never a window attached to it |
| Opening a link or file, Reveal in Finder | The window whose click asked for it; when the host itself asks, the app running it                                |
| Closing a device's popout                | Every window, since each has its own popouts                                                                      |

The host counts any Argus window in front as you looking at Argus, so it
skips the banner either way.

## Building it

```sh
open clients/apple/ArgusRemote.xcodeproj   # scheme: ArgusDesktop
```

A build phase stages the Node host into the app
(`pnpm build:mac-host --out <dir>`). Debug builds are called **Argus Dev** and
never default to `~/.argus` — they use `~/.argus-mac-dev` unless `ARGUS_HOME`
says otherwise — so a dev build can't collide with the app you use.

To develop against your real projects and agents, start a dev build with
`ARGUS_ATTACH_HOME=~/.argus`. It then only ever attaches to the Argus already
running on that home, as a second window: it never starts a host there, takes
the lock, offers to take over, or copies its settings in. With nothing running
it waits for one. Its own state (window tabs, paired hosts) stays in its own
home. They are
signed with your Apple Development identity: macOS refuses notifications to an
ad-hoc signed app, and to one run from `/tmp`.

Telemetry needs a PostHog key at build time, as for the Electron app:
`POSTHOG_KEY` in the environment `xcodebuild` runs in, or `POSTHOG_KEY = …` in
a gitignored `clients/apple/Config/Argus.local.xcconfig`, which also covers
builds started from Xcode. Without one the host logs that telemetry is off.
