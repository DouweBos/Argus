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
  The sidebar searches sessions and narrows to one project, lists Home, Inbox,
  Agents, Devices, Runtimes and Automations under the search, and keeps
  Settings, Pull Requests, Usage and Notifications as icons along its foot. The toolbar shows where you
  are (**Project / Session**) and the side panel toggle.
- A session's context card, top right of its Agent, Code and Git views. Its
  first row switches between them (**Agent | Code | Git**, ⌘1–⌘3); below
  that, its machine, opening it in your editor, its run command and huddle,
  its branch, pushing it, how much it has changed, and **Recent Chats**: a
  dialog that searches the session's past chats (imported ones too), opens,
  resumes or deletes them, or clears them all. The chevron folds the card
  down to its switcher, which then sits in the view's top bar; each view
  remembers its own choice. Agent starts with the card open, Code and Git
  with it folded, so their tab bars stay clear. While it's folded, the run
  command and huddle move to the toolbar.
- Creating and deleting sessions, with setup progress.
- Agents in a session as tabs, with their transcript: one centred column, each turn's tool calls folded into a "Worked for …" line that opens in place.
- Opening a session shows its agents. With none running yet, it's the start
  composer, "What should we work on?": sending starts an agent there, in the
  permission mode its pill picks (plan mode included). A session that's
  still being set up shows each setup step, or why it failed. The View menu,
  the command palette and ⌘1–⌘3 switch views too; the Agent menu starts,
  switches and interrupts agents (see [Keyboard shortcuts](#keyboard-shortcuts)).
- **Home** in the sidebar (⇧⌘H): the app's home screen.
- **Agents** and **Runtimes** in the sidebar: every agent, and every run
  command's process, across all your sessions.
- A side panel beside each session (⌘J), closed until you open it: tabs for
  terminals, the device, the browser, the session's files, its diff and its
  pull request. Its **+** menu opens a tab (press B, T, F, D, P or M while it's
  open; kinds with nothing to show are dimmed), tabs drag to reorder, and the
  panel can fill the window. It never opens by itself; open tabs, the one in
  front and the width are remembered for each session.
- Terminals as side panel tabs (⇧⌘T): several at once, the project's run
  commands in the context card (the toolbar when it's folded) opening their
  output in a tab, find (⌘F), and links that open on this Mac. A terminal you
  reopen replays what it printed so far.
- Banners for agents that finish or need you, with Approve/Deny buttons on
  permission prompts.
- The Device and Browser tabs (⌥⌘B for the device): each session's simulator,
  emulator or browser, live, to tap, type, scroll and rotate; Simulate,
  Inspect (the iOS UI inspector) and Logs modes; devices in their own floating
  windows. DevTools for the session's browser open in a window of their own.
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
- **Pull Requests** at the foot of the sidebar: the pull requests that need you across
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
- **Settings** (⌘,): a list of sections on the left and each section's
  settings in one centred column — appearance (colour scheme and colour
  theme as preview cards), Claude accounts, agents and automation
  defaults, LLM runners including custom ones, MCP servers, tools, git
  defaults and commit signing, the update channel, remote access —
  pairing a phone, its grants, push and tunnels — and your Argus account
  (see [Other hosts](#other-hosts)).
- **Project Settings** from a project's menu in the sidebar: every
  `.argus.json` field, plus your own branch prefix and worktree locations.
- **Automations**, **Quick Run**, the **Inbox** and its proposals, and
  **Notifications**, the warnings and errors list.
- Hosting a huddle from a session, with guest approval and side chat.
- The command palette (⇧⌘P), its results grouped by kind with their
  shortcuts, and Handoff of the session on screen to your
  phone.

## Keyboard shortcuts

Every shortcut is a menu item, so the menu bar lists them all and greys out
the ones that don't apply where you are. They match the Electron app's,
except where macOS or the Mac app's own layout already uses the keys.

| Shortcut              | Does                                                       | Menu  |
| --------------------- | ---------------------------------------------------------- | ----- |
| ⌘N                    | New session                                                | File  |
| ⇧⌘O                   | Open a session (quick switcher)                            | File  |
| ⌘O                    | Add project                                                | File  |
| ⇧⌘P                   | Command palette                                            | File  |
| ⌘⌫                    | Delete session                                             | File  |
| ⌘,                    | Settings                                                   | Argus |
| ⇧⌘A, ⌘T               | New agent in the session on screen                         | Agent |
| ⌘.                    | Interrupt the agent in front                               | Agent |
| ⌘L                    | Focus the chat input                                       | Agent |
| ⇧⌘] / ⇧⌘[             | Next / previous agent                                      | Agent |
| ⌃⌘1 – ⌃⌘9             | The session's first to ninth agent                         | Agent |
| ⌘F, ⌘G, ⇧⌘G           | Find in the chat (or the focused terminal), next, previous | —     |
| ⌘1 – ⌘3               | The session's Agent, Code and Git views                    | View  |
| ⌘[ / ⌘]               | Back / forward                                             | Go    |
| ⇧⌘H                   | App home                                                   | View  |
| ⌥⌘1 – ⌥⌘5             | Agents, Devices, Runtimes, Pull Requests, Notifications    | View  |
| ⇧⌘I                   | Inbox                                                      | View  |
| ⌘J                    | Show or hide the side panel (per session)                  | View  |
| ⇧⌘T                   | Open a terminal tab, or hide the panel when one's in front | View  |
| ⌥⌘B                   | Open the device tab, or hide the panel when it's in front  | View  |
| ⌥⌘T, ⌘W, ⌃Tab / ⌃⇧Tab | New, close and cycle window tabs                           | View  |

Back and forward step through the window tab's history, as in Finder: every
screen, session panel, agent, git view and code-view file you open is a step.
The toolbar's chevrons and a mouse's side buttons do the same.

Where they differ from the Electron app:

- **⌘1–⌘3** switch the session's Agent, Code and Git views, as Xcode
  and Finder number theirs, so agents are on ⌃⌘1–⌃⌘9 and window tabs have no
  number keys.
- **⌘T** starts an agent (agents are the session's tabs) and **⌥⌘T** opens
  a window tab, where Electron uses ⌘T for window tabs.
- **⌘J** shows the side panel, where terminals live too, as VS Code's does
  its panel. **⌥⌘H** isn't used: it's macOS's Hide Others, so there is no
  project-home shortcut. **⌘B** is the code view's navigator, not the app sidebar.

The code view takes a few of these keys for its own, as VS Code and Xcode
do, only while it's on screen: ⇧⌘O is Open Quickly there instead of Open
Session, ⌘T goes to a symbol rather than starting an agent, ⌘L selects a line
(there's no chat input to focus), and ⌘[ / ⌘] outdent and indent while the
editor has focus. ⌘W closes the editor tab before the window tab.

### In the code view

The code view (⌘3) uses VS Code's default macOS keys, listed in the Editor,
Selection, Go and View menus. Editing keys work on every caret at once, and
each change undoes in one step.

| Keys       | Action                                             |
| ---------- | -------------------------------------------------- |
| ⌘P         | Open a file by name                                |
| ⇧⌘O        | Open Quickly: files and symbols together           |
| ⌘T         | Go to a symbol anywhere in the session             |
| ⇧⌘F        | Find in files                                      |
| ⌘F / ⌥⌘F   | Find / replace in the file                         |
| ⌘G / ⇧⌘G   | Next / previous match                              |
| ⌘S / ⌥⌘S   | Save / save all                                    |
| ⌘W         | Close the editor tab                               |
| ⌘/         | Toggle line comment                                |
| ⇧⌥A        | Toggle block comment                               |
| ⌥↑ / ⌥↓    | Move lines up / down                               |
| ⇧⌥↑ / ⇧⌥↓  | Copy lines up / down                               |
| ⇧⌘K        | Delete lines                                       |
| ⌘↩ / ⇧⌘↩   | Insert a line below / above                        |
| ⌘] / ⌘[    | Indent / outdent (in the editor; Tab and ⇧Tab too) |
| ⌘L         | Select the line; again for the next one            |
| ⌘D         | Add the next match to the selection                |
| ⇧⌘L        | Select every match                                 |
| ⌥⌘↑ / ⌥⌘↓  | Add a cursor above / below                         |
| Esc        | Back to one cursor                                 |
| ⇧⌘\        | Go to the matching bracket                         |
| ⌃G         | Go to line (`line` or `line:column`)               |
| F12 / ⇧F12 | Go to definition / find references                 |
| F2         | Rename symbol                                      |
| ⇧⌥F        | Format document (the project's formatter first)    |
| ⌃Space     | Show completions                                   |
| F8 / ⇧F8   | Next / previous problem                            |
| ⇧⌘M        | Show or hide the problems list                     |
| ⌘B         | Show or hide the navigator                         |
| ⇧⌘E / ⌃⇧G  | Navigator: files / changes                         |
| ⌥⌘→ / ⌥⌘←  | Next / previous editor tab                         |
| ⌃- / ⌃⇧-   | Go back / forward                                  |
| ⌥Z         | Toggle word wrap                                   |
| ⌃\`        | Open a terminal tab, or hide the panel             |
| ⌥⌘L        | Send the selection to the session's agent          |

In ⌘P, a prefix changes what you're looking for, as in VS Code: `@` lists
the symbols in the open file (`@:` groups them by kind), `#` searches symbols
across the session, and `:` goes to a line (`:42`, or `:42:7` for a column).
Symbols come from Argus's own index of definitions, so they work before any
language server has started, and from the session's running language servers
when there are some. Changed files rank first. ↑/↓ (or ⌃P/⌃N), Page Up/Down
and Home/End move through the results while you keep typing; Return opens one.

## Other hosts

Argus for Mac can drive other machines running Argus — another Mac, a
headless Argus server, or `argus-host` — as well as its own:

- **Settings → Argus Account** signs in with Apple, GitHub or an emailed
  code. The first sign-in on an empty account puts this Mac on it and links
  its own host straight away, with no code, so your phone sees it. The tab
  shows the account's safety code, every host on it as online or
  "Offline · last seen …", and **Add a host**: type the code another
  computer shows (`argus-host login`, or Sign in in Argus there) and compare
  the 6-digit codes. Sign Out takes this Mac off the account.
- If your account already has devices, this Mac can't add itself yet;
  **Link this Mac with a code** shows a code to add from your phone instead.
- **Settings → Hosts** lists the hosts on your account beside paired ones and
  attaches them with no pairing code; a host whose tunnel address changed is
  found again from the account. To pair without an account, paste the pairing
  code from that machine's Remote screen, compare the 6-digit code, and approve
  it there with **Admin** ticked. Paired hosts can be renamed, attached,
  detached, shown or forgotten.
- Attached hosts' projects sit in the sidebar beside this Mac's, each marked
  with its machine and whether it's connected. The machines button at the top
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
- Sessions, agents, terminals and the side panel's device and browser of a remote project run
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
only your user can read. The account key is kept in the Keychain, on this Mac
only.

Sign in with Apple needs the app's Sign in with Apple entitlement; a build
signed without it offers GitHub and email only.

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

Sign in with Apple needs a provisioning profile. Debug builds get one through
Xcode's automatic signing (your Mac has to be registered with the team).
Release builds are signed with Developer ID and a profile from fastlane match;
create it once with `bundle exec fastlane mac mac_app_profile generate:true`,
and on any other machine install it with `bundle exec fastlane mac
mac_app_profile`.

Telemetry needs a PostHog key at build time, as for the Electron app:
`POSTHOG_KEY` in the environment `xcodebuild` runs in, or `POSTHOG_KEY = …` in
a gitignored `clients/apple/Config/Argus.local.xcconfig`, which also covers
builds started from Xcode. Without one the host logs that telemetry is off.
