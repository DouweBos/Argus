
### Minor Changes

- 1de4556: Automations can now see your work and put it in front of you. A new Morning triage automation pulls the issues assigned to you and the pull requests waiting on your review, ranks them by what is blocking other people, and proposes what to do about each one. Proposals wait for you: start one and Argus opens a worktree with an agent already briefed on it, or dismiss it with a reason. If GitHub is not signed in the run still finishes and simply reports that it found nothing.
- 1de4556: Automation runs now write real dashboards — headline numbers, tables, charts
  and live proposal cards — instead of a wall of text. Linear issues can feed a
  run alongside GitHub, and there are four new built-in automations to turn on: a
  PR shepherd that sends red CI back to the session that wrote the branch, a
  nightly regression sweep that drives your app on a simulator, a branch janitor
  and a weekly dependency watch. Each automation now shows how often you actually
  accepted what it proposed, and tells its next run what you turned down and why.
- 1de4556: Automations get their own screens: see every automation, switch it on or off, run it now, and watch the run progress live. Each automation has an editor for its playbook, schedule and model — with the next few fire times shown next to the cron field so you can tell what you just typed. Every run keeps its report, cost and duration, and links straight to the agent transcript behind it.
- 1de4556: Files dropped into the chat now reach a connected host: the bytes are uploaded instead of a path that only exists on your laptop, with files over 8 MB refused by name. Git failures on a host keep their detail and recovery actions, and file reads and writes from a paired Mac stay inside the session's worktree and your registered projects.
- 1de4556: The embedded browser now works while you're connected to another Mac: its page streams to you from the host running it, and clicks, typing, scrolling and navigation go back to that machine. When two people are attached to the same host, whoever starts interacting keeps the browser until they stop.
- cee3f88: Update the bundled conductor CLI to v0.32.0.
- 1de4556: Update the bundled conductor CLI to v0.33.3.
- 1de4556: Files dropped into the chat while connected to another Mac now upload in chunks with a progress bar, so a screen recording or a large patch goes through instead of being refused. The attachment limit rises from 8 MB to 512 MB, and an interrupted upload leaves nothing half-written on the host.
- 1de4556: Describe an automation in a sentence and Claude drafts it for you: a name, a
  playbook and a schedule you can check against its next fire times before saving.
  Drafts arrive disabled and at the default autonomy, and a schedule that does not
  parse falls back to manual rather than being saved broken.
- 1de4556: Edit a message you've already queued from the phone or the web client, instead of deleting it and typing it again.
- 1de4556: Automations can now do the work, not just suggest it. Each automation has an autonomy level — propose, draft, pull request or auto-merge — with a confidence threshold, a session limit, a file-count limit and a path denylist. Proposals that clear them start their own session; everything else waits in the inbox. Set the default in Settings and cap it per repository in Project Settings.
- 1de4556: Open a huddle link in a browser to join someone's agent. Give your name, wait for the host to let you in, then follow the conversation, send messages, approve the agent's tool calls and drive the shared simulator — and nothing else on their machine.
- 1de4556: The home screen now lists your most recent automation runs, so you can see what fired overnight without opening Automations.
- 1de4556: A guest who closes the huddle tab and opens the link again is recognised as the same person: their name is remembered, they're re-listed in place instead of appearing twice, and you're asked to let them back in.
- 1de4556: Guests can now see who else is in the huddle, and leave it themselves without closing the tab.
- 1de4556: A huddle now follows whatever device you have open — start or switch a simulator mid-share and your guests get it too, instead of being stuck with whatever was running when you made the link.
- 1de4556: Remove someone from a huddle you're hosting, which also clears rows left behind by guests who have gone.
- 1de4556: The new Inbox screen collects everything Argus wants from you in one place: proposals waiting on a decision, work it has already started, and automation runs that failed. Each proposal shows how sure it is of itself and offers exactly three things to do — start it, dismiss it with a one-line reason, or open the issue it came from. You can make the Inbox the screen Argus opens on in Settings → Appearance.
- 1de4556: Run agents on another Mac and drive them from this one. Pair a host under Settings → Hosts, grant it admin there, then attach it from the connection menu in the title bar — its projects, sessions and agents appear alongside this Mac's. Attached hosts are restored on launch, reconnect on their own if the link drops, and project folders are picked from the host's own disk.
- 1de4556: Attach several machines at once — a Mac mini for iOS work and another box for Android, say — instead of switching between them. Projects and sessions show which machine they live on, each connection reconnects on its own, and a host going offline leaves its last state readable while the others keep running.
- 1de4556: Messages sent by a huddle guest now show their name above the bubble, so everyone in the room can tell who said what.
- 1de4556: Argus Server can now update itself from its tray menu — check, download, and restart into a new version without touching the machine over SSH. Restarting is refused while agents are running, and an optional "Install Automatically When Idle" toggle takes the update as soon as the last agent finishes.
- 1de4556: When another client is driving a simulator or an embedded browser on a host you're attached to, the screen now says who has control and offers a Take control button, instead of quietly ignoring your taps. Control frees up on its own after 30 seconds of inactivity.
- 1de4556: Run a playbook once without creating an automation for it. Automations → Quick
  run takes a playbook and a set of projects, runs it with the same agent,
  guardrails and autonomy ladder as a scheduled run, and saves nothing. When you
  like what it did, one button turns the run into a real automation, prefilled
  with what you just ran.
- 1de4556: Automations: give Argus a clock. Create an automation with a schedule or run it
  on demand, and it starts an agent on its own in a neutral workspace and leaves a
  markdown report behind. A run that comes due while the last one is still going
  is skipped rather than doubled up, and a night of missed schedules produces one
  catch-up run instead of a backlog. Ships with a Standup digest — a read-only
  summary of yesterday's branches and sessions — seeded and switched off until you
  want it.
- 1de4556: Argus can now be installed as a separate headless server app that runs with no window, so a spare Mac can keep agents and simulators going around the clock. It keeps its own projects, worktrees and settings, stays awake on its own, and can start automatically at login.
- 1de4556: Argus Remote can now watch your computer's automations from your phone — the recent runs, each run's report, and Run now for devices you granted control.
- 1de4556: The phone's computer screen now lists every address it knows for that computer — local network, Tailscale, Cloudflare — and marks the one the current connection is running over.
- 9dbd114: Remote access ways in are now independent: run the local network, Tailscale and Cloudflare at the same time instead of picking one. Paired phones learn every address on connect and automatically connect over the simplest one that works, so turning on a new way in no longer means re-pairing.
- 226eb2b: Remove organizations and cross-repo tasks. Argus is now built around projects and sessions only — the Organizations screen, sidebar section, and task orchestration are gone, along with the agent prompts and MCP tools that went with them.
- 1de4556: Automation reports can now come back as a dashboard: headings, stat strips, tables, lists, bar and line charts, plus live cards for the sessions and proposals they mention. Reports written as plain markdown keep rendering exactly as before.
- 1de4556: Share an agent from the agent bar and get a link to paste into a huddle. Whoever opens it waits until you allow them in, and you can see everyone who has joined and end the share at any time.
- 1de4556: First launch is now just a welcome screen and a telemetry choice. Missing setup — the Claude CLI, a signed-in Claude account, git, your git identity, notification permission — shows up as a card on the home screen with a one-click fix instead of a wizard step, and your git identity is now editable in Settings → Git.
- 1de4556: Two clients attached to the same host no longer collide: answering a permission prompt clears it everywhere, and one client at a time drives a simulator while the others watch and can take over.
- 1de4556: The window now has browser-style tabs, so you can work on a paired Mac and on this one side by side — each tab remembers its own machine and screen, with "This Mac" pinned first. Open tabs with ⌘T, the "+" button or ⌘-click on a session, and they come back where you left them after a restart. ⌘1–9 now jump between tabs, so the screen shortcuts (Agents, Devices, Runtimes, Pull requests, Notifications, Organizations) moved to ⌥⌘1–6.
- 9dbd114: Guide Tailscale remote access setup in Settings. Argus now checks the CLI, the Tailscale service, your sign-in, and whether Funnel is enabled, and offers a one-click fix for each instead of showing a bare "error".
- 1de4556: Paired devices can now be granted admin access, letting another Mac of yours drive this one as if you were sitting at its keyboard, while window, updater and pairing actions stay on the host. Sessions can only be created in projects you have added, and remote devices can no longer start an agent that skips permission prompts.
- 1de4556: Argus Server can now pair its first device from the menu bar: it copies the pairing code for you, shows the confirmation number to check against your desktop, and lets you grant full control or view-only access.
- 1de4556: See a paired host's simulators from here. The runtime panel now streams the host's iOS and Android device screens live, and taps, swipes, keys and hardware buttons go back to the device, so you can validate a change against the machine that ran it.
- 1de4556: The browser client is now served over every way in, so a Tailscale or Cloudflare URL opens the app in a browser without also turning on the local network toggle. That toggle now only decides whether the gateway listens on your Wi-Fi interface.

### Patch Changes

- 1de4556: Automations now stop at their autonomy level in the terminal too: a session an
  automation started cannot push a branch or open a pull request from the shell
  unless the automation is allowed to. Cost limits are enforced — a run that
  reaches its ceiling is stopped, and runs are skipped once the day's budget is
  spent. A session holds its concurrency slot until it is merged or deleted, and
  an automation can only touch sessions it created itself.
- 1de4556: Automation runs no longer stall on a permission prompt when they report what they found.
- 1de4556: Automation screens scroll again instead of squashing the last card off the bottom.
- 1de4556: Fix the Automations screen crashing with a render loop instead of showing your automations.
- 1de4556: Diffs, logs and other git output larger than 1 MB no longer fail to load.
- 5d1f7a3: Cmd+T now opens a single new tab instead of two, and opens a new terminal when the terminal has focus.
- 1de4556: You can now widen what a read-only automation may do. When a run is refused, the attempt is listed in Settings with the entry that would allow it, so permitting it is a click rather than a guess. Projects cannot add to the list — it stays your decision.
- 1de4556: Detaching a host no longer pulls its tabs back to this Mac. They stay where they are showing the last snapshot, marked disconnected, exactly like a host that dropped on its own. Forgetting a paired host in Settings still clears its projects and sessions.
- 1de4556: Devices with the same id on two attached machines no longer collide in the home screen and device grid.
- e5806be: The documentation now covers remote access, working across several Macs, huddles, the headless server app and automations, and no longer claims Argus embeds a code editor.
- 1de4556: Show the screen that's actually lit on folding devices like the iPhone Duo — the runtime view captured the dark inner panel while the phone was closed.
- c7b75b1: Fix sign-in failing for MCP servers like Linear that require HTTP Basic client authentication.
- 1de4556: When a git command produces more output than Argus can read, it now says so and suggests viewing the change file by file, instead of failing with an unrelated-looking error.
- 1de4556: The huddle dialog's contents no longer run flush to its edges.
- 1de4556: Guests can see which person in the huddle is currently driving the device.
- 1de4556: Fix signing in to MCP servers like Linear that rejected the token request with "must not use multiple authentication methods".
- 1de4556: Agents now keep related work in the checkout they're already in, instead of creating a worktree for every task. Unrelated work still gets its own worktree, and asking for one always works.
- 1de4556: The Open Project dialog now lists only the recent projects for the machine whose tab you are on, so picking one can't switch the tab to a different machine.
- 1de4556: Opening a folder you browsed on a paired machine now adds it as that machine's project, instead of recording it against this Mac.
- 1de4556: Pasting a pairing code on your phone no longer leaves the keyboard covering the Pair button, and the keyboard's Done key dismisses it.
- 1de4556: Argus Server now offers all three access levels when approving a device — watch only, run agents, or full control — instead of only the two extremes, with the safest listed first.
- 376d5f0: Sharing an agent now checks that a public link actually reaches your Mac before handing it out, so a Tailscale funnel whose machine isn't connected to the tailnet no longer produces a dead link — Argus falls back to a working address instead, and Settings marks the tunnel as unreachable.
- 1de4556: Messages sent from a phone or a huddle now always wait for the current turn to finish — the computer decides whether to queue, so a stale view of the agent never lets one jump in mid-turn.
- 1de4556: Fix the Claude account switcher showing "Sign in again" on every account, and stop agents from running against a removed account — which made them fail with authentication errors.
- 1de4556: A connected desktop can no longer browse the host's whole disk through the @-mention picker, and two desktops attached to the same host take turns driving a simulator instead of fighting over it.
- 1de4556: A read-only automation can no longer reach past reading. It runs in plan mode again — without the stalls that used to cause, because Argus now answers every permission request itself — and its shell is limited to commands that only observe, so it cannot write files, install packages, or send your data somewhere.
- 1de4556: Built-in automations now pick up playbook improvements from new releases, as long as you have not edited them yourself. The playbook and the description are judged separately, so editing one still lets the other improve, and neither is ever overwritten once you have changed it. A refresh never touches your schedule, scope or whether the automation is on.
- 1de4556: Opening a new huddle link now joins the new room instead of staying on the "the huddle ended" screen.
- 1de4556: Automations now screen the issues, tickets and review comments they fetch. Text from outside is marked as data rather than instruction, and anything that reads like an attempt to steer the run is withheld and reported instead of acted on.
- 1de4556: Argus Server now accepts connections from other machines on the network, and pairing no longer hands out an address it isn't listening on.
- 1de4556: Terminals no longer fail to open when `$SHELL` points at a shell that is not installed on this machine. Argus falls back to `/bin/sh` and says so, instead of failing with an unexplained spawn error.
- 1de4556: Fix connecting to and controlling simulators under Xcode 27, including the iPhone Duo and Apple TV. Touch, keyboard and remote input work again.
- 1de4556: The Standup digest now calls out finished work that is waiting on you, and says whether each branch wants a pull request or a merge.
- 1de4556: A paired machine's tab now shows only that machine's projects, while this Mac's tab keeps the combined view with each project badged. Tabs no longer label this Mac by name.
- 1de4556: The Apple TV remote now says when another client is driving the device and offers a takeover, instead of quietly ignoring your button presses.
- 1de4556: Fix the Apple TV remote doing nothing on tvOS 27 — presses reach the simulator again, with no test-runner app installed on your device.
- 1de4556: Automation runs no longer stop to ask for permission. A read-only run used to sit waiting on a prompt nobody was there to answer and time out after 20 minutes; it now runs to completion. Read-only runs still cannot change anything — writes are refused whether the run reaches for an edit tool or a shell command.
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
- Updated dependencies [226eb2b]
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
- Updated dependencies [1de4556]
  - @argus/peacock@0.13.0

