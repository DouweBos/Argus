# argus

## 0.62.1

### Patch Changes

- 8fcdcee: Changing a project's worktree location now offers to move its existing worktrees instead of reporting that there are none.
- 977bb03: Agents waiting on a question or permission no longer show as stopped.
- 3511d86: Picking a different Claude account for a new agent that hasn't been messaged yet now runs it on that account, and the phone app's chat input can switch accounts too. A switch that fails now shows an error instead of claiming the new account.

## 0.62.0

### Minor Changes

- 549741c: Automation runs can now read GitHub CI logs, artifact lists and the contents of test artifacts, including read-only runs.

### Patch Changes

- 4f7dfbd: Read-only automation runs can now withdraw their own proposals once the branch, PR or issue behind them is gone.
- e5419f6: The inbox no longer lists started work under "Argus is on it" once its session has been merged or deleted.
- c723676: Text fields in the iOS app now offer autocorrect, predictive text and capitalization for written input like plan feedback and messages, while branch names, codes and paths stay verbatim.
- 5c981f1: Handing a plan off to a new session from the iOS app now starts the agent on your computer, even if the phone is locked or the app is closed while the session sets up.
- fcd6564: An account marked Limit reached is re-checked in the background, so the badge clears once its quota resets instead of lingering until an agent runs on it.

## 0.61.0

### Minor Changes

- a2215da: Argus has a new peacock-eye app icon. On macOS 26 it follows light and dark mode, and the iPhone app gets dark and tinted versions.
- a2215da: Scratch pads let you start an agent that belongs to no project, in its own folder, from the sidebar, the command palette or the iOS app.

### Patch Changes

- a2215da: Accounts are no longer marked as signed out or out of usage just because an agent read or wrote text about limits, and session limits are now recognised as a spent quota.
- a2215da: Agent status now follows Claude Code's own busy state, so an agent that keeps working after a reply, such as while background tasks finish, no longer shows as idle.
- a2215da: Read-only automation runs now file their report and save memories instead of skipping them because plan mode is on.
- a2215da: Automation runs no longer show up as projects under Recent projects on the home screen.
- a2215da: The iOS app opens agents with long transcripts instead of dropping the connection and showing an empty conversation.
- a2215da: Tapping a notification while the iOS app is locked no longer crashes it; the app asks you to unlock, then opens the agent.
- c9f6c34: Tool search calls now list the tools they loaded instead of showing empty result rows.
- Updated dependencies [a2215da]
  - @argus/peacock@0.22.0

## 0.60.0

### Minor Changes

- 7dcafbe: Automations keep memories between runs, so they stop re-learning your codebase every time. You can read, edit and delete them in the automation's settings.
- 11f210d: The iOS app can now change which branch a session merges into, and shows the current one on the "Land this work" card.
- 3b2123f: Tapping a branch in the iOS app now opens it: its history, each commit's diff, a comparison with the checked-out branch, and the same actions as the desktop's branch menu — switch, branch from it, merge, rebase, push, pull, rename, pin, open a PR and delete.
- b360919: Merging a session into its base branch now asks whether to keep every commit or squash them into one — it no longer squashes silently.
- 719f4be: Proposals in the inbox have a View run button that opens the automation run that raised them, so you can read its report or leave feedback without hunting for it — on desktop and on your phone.

### Patch Changes

- 7dede34: The branch menu's rebase item now says which branch gets rebased, Open PR on GitHub opens the right repository, and deleting a branch that isn't fully merged asks before losing its commits.
- 6ac73e5: On iOS, linked-project chips on your own messages now line up with the message on the right.
- 149e9ca: The iOS app now reports anonymous usage and crash data, with the same privacy controls as the desktop app. Pick how much to share on first launch, and change it any time under Settings → Privacy.
- 53b726e: On iPhone, linked projects are cleared after a message is sent, so they no longer carry over to the next one.
- f4c733b: Fixed a merge against a base like `origin/main` collapsing the session's commits before failing. The base is checked first, and a session pointed at a remote-tracking branch is repaired to the local branch behind it.
- f49ca0a: The context meter uses the window size Claude Code reports for the model, so 1M-context models no longer show as 200k.
- Updated dependencies [719f4be]
  - @argus/peacock@0.21.0

## 0.59.0

### Minor Changes

- a73842e: Each automation can opt out of retrying on another Claude account when it hits a usage limit, from the desktop editor or the phone.
- cff9f8f: When an automation run hits a Claude usage limit, it retries on your other signed-in Claude accounts before failing.

### Patch Changes

- 7720bb2: Automation runs that hit a usage limit or end in an error are now marked as failed instead of succeeded.

## 0.58.1

### Patch Changes

- 545064d: The Claude account warning on the Home screen now checks every signed-in account instead of only the selected one, and says which case you are in: a rate-limited or signed-out account selected, every account out of usage, or nobody signed in.

## 0.58.0

### Minor Changes

- a52a6a0: Manage Claude accounts from your phone: add, remove, rename and switch accounts
  from Settings, and finish a sign-in by pasting the code your computer shows.

### Patch Changes

- a1a9a9d: The account switcher now shows which account you are actually signed in as, and
  tells a spent weekly limit apart from an expired sign-in. The limit badge clears
  on its own once a run succeeds.
- Updated dependencies [a1a9a9d]
  - @argus/peacock@0.20.0

## 0.57.0

### Minor Changes

- 032d203: Rewrite an automation's playbook with Claude from its configuration — describe what should change and review the result before it is saved.
- 361e039: Disagree with an automation report: **Give feedback** on a finished run hands your note back to that run's own agent, which re-checks what it claimed and publishes a corrected report. Feedback only ever adds proposals — the ones already in your inbox stay put unless you switch on "Let it remove proposals".
- 7f26087: Pick which runner a new agent starts on from the iOS app, alongside its model and permission mode.
- c7abc56: Set an automation's time limit from the iOS app, alongside the other guardrails.
- 76f5610: Rewrite an automation's playbook with Claude from the iOS app, the same as on the desktop.
- 1ceb8cf: Stopped agents on iOS are now listed under the session they ran in, instead of one long list at the bottom of the project. Only the ones whose session is gone stay at the bottom.

### Patch Changes

- d04811a: Fix Android emulators showing no video in the iOS and web clients.
- 29866ab: The iOS chat input now offers autocorrect, predictive text and sentence capitals, and collapses back to one line after you send.
- 27ed3be: Editing a queued message on iOS now opens a proper editor instead of an inline field that scrolled away and wouldn't take the keyboard.
- 81fc794: Fixes a message sent from the iOS app jumping ahead of the agent's current turn instead of waiting in the queue.
- 5df89c6: The iOS app now lists every saved conversation a project kept, not just the twenty most recent.
- d1492dc: The Standup digest no longer reports already-merged branches as unshipped — it now checks whether the work is really missing from the base branch before asking you to open a PR.

## 0.56.0

### Minor Changes

- 9d7eaf0: Automations can now pick their own runner and model instead of always using the app default, and the sessions their proposals start inherit it. Editable from the desktop editor and from your phone.
- a741578: Automations can now create their worktrees in a separate location, so a busy automation doesn't fill up your boot disk. Set it app-wide in Settings → Worktrees or per project in Project Settings; leave it empty and automations use the same place as your own sessions.

## 0.55.0

### Minor Changes

- 4a1402a: Pick a runner per agent instead of per session. Each new agent starts on the session's runner and can be switched until you send its first message, so one tab can run on a custom gateway while its siblings stay on Claude Code. The picker also stops claiming a switch that the app refused.

### Patch Changes

- effbe9a: The Apex runner preset now exposes a context-window field, so auto-compact can use the gateway's real limit instead of assuming 200k.
- bc535cd: CLI diagnostics like an unrecognized model id now read as warnings in the transcript, with their details spelled out instead of dumped as raw JSON. They were styled as errors, which made a harmless notice look like the run had failed.
- 864d296: Fixed a connected Mac showing no projects: its repositories were being registered against your own machine instead of the one they live on. Closing a project from a remote tab no longer closes your local copy of it either.
- 5d07388: Resuming a conversation, reopening a closed tab, or forking a chat now stays on the runner that produced it instead of falling back to the session's default.
- 864d296: The warnings and errors badge now opens the notifications screen when clicked from Home, instead of doing nothing.
- Updated dependencies [bc535cd]
  - @argus/peacock@0.19.0

## 0.54.0

### Minor Changes

- cf0bbe7: Automations now have an editable time limit. A long playbook no longer fails at a fixed twenty minutes — raise the limit on the automation, and a run that does hit it says so plainly instead of showing an agent id.
- 9e540b5: Argus now remembers which projects it has open across restarts, so a Mac you connect to comes back with its sidebar intact instead of empty — and any client that attaches to it sees those projects straight away.

## 0.53.1

### Patch Changes

- 1731950: An automation now runs at the level it sets for itself unless you actually pick a default autonomy in Settings, where "No cap" is the new default. Previously an untouched setting quietly capped every automation at Propose, so a Draft automation would only ever file proposals.
- 6cd3543: A message the phone couldn't hand to your computer now shows as "Not sent" with a retry, instead of looking delivered and quietly disappearing.
- 963cf7f: Inbox actions on the phone now wrap onto a second row instead of squeezing their labels into unreadable slivers.
- f0c4fdf: The chat input on iPhone really does shrink back to one line after a message is sent.
- b625c1d: The phone's background-push screen no longer suggests re-pairing to clear a stuck push registration — pairing was never what held it.
- 8d76141: An agent started from the phone no longer sits there spinning without ever picking up your first message.

## 0.53.0

### Minor Changes

- e7a6060: Hand off between the Mac and the iPhone app: whichever session you have open is offered on the other device, from the lock screen or the Dock.
- fdc48a3: Automations can now be created, edited and deleted from the iPhone app — schedule, projects, signal sources, autonomy, guardrails and the playbook — and paused straight from the automation screen.
- 89d365c: Commit, push and merge a session's branch straight from the iPhone app — the Changes screen now ends the loop instead of sending you back to your computer.
- c851b23: Pull requests reach the iPhone: see the ones waiting on you, read their checks and conversation, comment, merge, and open one for a session's branch straight from Changes.
- 4fb6b36: Run a playbook once from the iPhone with Quick run — nothing is saved behind it — and promote one that proved useful into a real automation from its run.
- d0cd6dc: New sessions on the iPhone can branch off a chosen base branch or adopt an existing one, and a new agent can be started on a specific model and permission mode.
- f2ea401: Morning triage now focuses on finding tickets to work on: it ranks your assigned issues, digs into the unclaimed backlog when those run short, and only raises a review when one is genuinely blocking someone.
- 5fe9005: Keep worktrees somewhere other than your boot disk — set a folder app-wide under Settings → Worktrees, or per project, and Argus offers to move the ones you already have.

### Patch Changes

- 4ae80e8: Automations now skip projects stored on a drive that isn't connected, and say so in the report instead of reporting no work found. A cleanup that would delete a branch or session on a disconnected drive is refused.
- 348ec4e: Fix deleting or renaming a session from the iOS app, which quietly did nothing, and show a message when a request to your computer fails.
- 4dc9354: The iPhone app now takes the interaction claim on a device it opens, says who is driving when someone else has it, and offers to take control instead of silently dropping your taps.
- 9cd21f5: The chat input on iPhone shrinks back to one line as soon as a message is sent, instead of staying tall until you type again.
- 1555f81: Session and project lists on the iPhone now update the moment something changes on your computer, instead of waiting for the next poll.
- e4141b8: Picker sheets on iPhone now respond to a tap anywhere on a row instead of only on the label.
- c2b8dbd: A plan on iPhone can now be handed to a brand-new session with "Approve in new session", leaving the current agent in plan mode.
- bb3a997: Approving a plan on iPhone switches the permission chip out of plan mode right away instead of waiting for the next refresh.
- 52956e4: Report list items in the iOS app now read left-aligned instead of centring when they wrap onto several lines.
- 44378b8: Unlocking your phone now refreshes the chat's queued messages and a project's git summary instead of leaving stale numbers on screen.
- 3b7d017: Session headers on iPhone now show the branch they're on, so the project root no longer hides which branch is checked out.
- 4ae80e8: The iPhone app now shows sessions whose drive isn't connected to your computer, greyed out and naming the drive, instead of offering actions that can't run.
- fd91c7c: Tapping a notification on iPhone now opens the agent it came from, including when the tap launches the app from cold.
- b794fc9: The iOS app can now open a plan full screen from an approval request, with the approve and feedback controls still at hand.
- 5fe9005: Sessions stored on a drive that isn't connected now stay in the sidebar, greyed out, and come back untouched when you plug it in. Previously they disappeared, and the worktrees could be left unusable.
- Updated dependencies [4d2a9a2]
  - @argus/peacock@0.18.1

## 0.52.0

### Minor Changes

- f5369e0: Proposals you already handled yourself can be marked as done instead of dismissed, so agreeing with one no longer reads as rejecting it.

### Patch Changes

- 0c9089a: Branch janitor now checks whether a branch's pull request was merged before anything else, so branches that landed as a squash merge stop showing up as unfinished work.
- Updated dependencies [f5369e0]
  - @argus/peacock@0.18.0

## 0.51.0

### Minor Changes

- 1111d9a: Huddle guests now get the same device controls the desktop has. The stream is presented the way the device is actually being held — a landscape iPad no longer shows up sideways, and taps land where you aim them — and you can rotate the device, fold and unfold a foldable, and drive an Apple TV with the Siri Remote.
- 4338b81: A huddle on a wide screen now shows the conversation and the shared device side by side in a resizable split, and the device gets a claim bar that says who's driving with buttons to take control or hand it back.
- 09b1a72: Answer a proposal with "yes, but": add a note to start it with extra instructions the agent follows, or ask the automation for a better version without starting anything.

### Patch Changes

- 7e0d47d: Huddle guests can rename themselves from a new settings button, the huddle now fills a landscape tablet instead of a narrow column, and chat avatars stay round next to multi-line messages.
- 09b1a72: Proposals in the inbox now render their markdown — headings, lists, code blocks and links read properly instead of showing raw syntax.
- a4613c1: Opening a tool call now shows what it was asked to do as labelled fields instead of a block of JSON.
- Updated dependencies [7e0d47d]
- Updated dependencies [4338b81]
- Updated dependencies [1111d9a]
- Updated dependencies [a4613c1]
  - @argus/peacock@0.17.0

## 0.50.0

### Minor Changes

- 6518f06: While you're sharing a device, the simulator now says who is driving it — and warns you when a guest is tapping at it and being refused because someone else holds it. The huddle's People list marks them too, so a guest stuck on a screen that won't answer is no longer invisible to everyone but themselves.
- 6518f06: Sharing an agent now hands you a ready-to-paste invitation — "Ana wants you to join “Fix the login flow” in Argus — <link>" — instead of a bare URL, so whoever gets it knows who sent it and what it opens. The link on its own is still one click away, and you can set the name it uses under Settings → Remote access.
- 6518f06: Huddles now have a chat for the people in them, so you can ask "which build is this?" without going back to Slack. Open it from the Chat button beside Share, or the chat tab if you joined by link — it shows a count of anything said while you were looking elsewhere. The agent never sees these messages, and they go when the huddle ends.
- 6518f06: Huddles now show who is typing. Guests see each other and you — by name — above the message box, and your People list marks anyone mid-sentence, so nobody sends the same thing twice.
- 6518f06: Unread automation reports now show up in the Inbox under "New reports", and the unread dot moved from Automations to the Inbox.
- 6518f06: The pairing confirm screen now says what is asking to pair — "Argus Remote on iPhone 17 Pro", "Argus Web on iPad", "Argus for Mac" — and only offers the second-keyboard grant to another Mac, since a phone or a browser could do nothing with it.
- 6518f06: Plan approvals now offer "Approve in new session" — it opens the new session dialog pre-filled with the plan so the current session can keep working.
- 6518f06: Cleanup proposals now come with the button that carries them out — delete the branch, retire the worktree — behind a confirm that names exactly what goes. Branch janitor uses it: it now proves whether a branch's work already landed (patch-id equivalence, a merged or closed PR, the ticket) and only proposes the deletions it can back up, leaving everything it is unsure about in the report instead of the inbox.
- 6518f06: The remote app can now rotate a simulator and fold an iPhone Duo, and presents the stream the right way up when the device is on its side.
- 6518f06: The remote web client now uses the full screen on an iPad or a desktop browser: your projects and sessions stay in a resizable sidebar beside whatever agent, device or diff you have open. Phones keep the single-column layout.

  Touch handling got a pass too — pinch-zoom works again, the composer stays above the keyboard, the layout clears the notch in landscape, and hover styles no longer stick after a tap. With a hardware keyboard, Cmd+[ and Cmd+] move back and forward, Cmd+\ toggles the sidebar, Cmd+K jumps to the composer and Cmd+/ lists the lot.

  The remote client's model, mode and project pickers, its slash-command list and its @-mention picker now look and behave exactly like the desktop's, and its session cards pick up the desktop styling.

- 6518f06: Apple TV and Android TV devices get a proper on-screen remote in the remote app, and a connected hardware keyboard's arrow keys and Return drive the d-pad.
- 6518f06: An automation's spend ceiling is now editable in its own settings and ships off, for built-in templates as much as for your own. Nothing caps what a run may cost until you say so, and the $5 ceiling older automations were given without asking is cleared on upgrade.
- 6518f06: Morning triage now counts what you already have in flight — open PRs, running sessions, proposals still waiting — and reaches further down its list to top you back up to about four. A quiet morning gets you real work to pick up instead of a reminder to merge something.
- 6518f06: In the web client, Enter now sends (or queues) your message and Shift+Enter starts a new line, matching the desktop app. On a phone, where there's no Shift to reach a new line with, Enter still breaks the line and the send button sends.

### Patch Changes

- 6518f06: Dialogs now share one consistent layout. The automation, device and source-control dialogs no longer run their content against the edge of the window, and every dialog's fields line up with its title.
- 6518f06: Your own messages and queued messages now carry your name while an agent is shared, so guests can tell your messages from each other's instead of seeing unattributed ones.
- 6518f06: Picking a shut-down iOS simulator now boots it automatically instead of sitting on "Connecting to device…" — Xcode 26 and later removed Simulator.app, which used to boot the device as a side effect.

  Folding or unfolding an iPhone Duo no longer leaves the device screen black; the stream now follows the panel switch.

- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
- Updated dependencies [6518f06]
  - @argus/peacock@0.16.0

## 0.49.0

### Minor Changes

- efd8260: Automation runs now see the proposals still waiting in your inbox, so a daily run stops proposing the same thing twice: it replaces its earlier proposal instead, or withdraws it once the PR was merged or the issue closed without you. Anything a run cleared is listed in the Inbox for a day with the reason it gave.
- 591a94b: The built-in Standup digest now proposes the follow-ups it finds — a finished branch with no PR, a green PR waiting on a merge, a session that stalled — instead of only describing them. It re-proposes yesterday's rather than duplicating it, and withdraws anything that shipped overnight.

## 0.48.0

### Minor Changes

- f38bb67: Branch janitor now spots branches finished by a squash merge, which leave no trace in the commit history but do delete their remote. It also covers local branches with no Argus session behind them, proposing the exact command to clear each one.
- b8780e4: Runs can now be deleted outright — from a run's page or its row in the history — removing the report and any proposals it raised. Failed runs can still just be dismissed from the inbox when you only want them out of the way.

## 0.47.0

### Minor Changes

- 256e8c8: Proposals on home are now short summaries that open a full proposal page, where the summary, rationale and the decision itself live.

  Proposals mentioned in an automation's report now link straight to that proposal.

## 0.46.0

### Minor Changes

- 844011e: Automations show their trail in the window title bar — Argus · Automations · the automation · the run — instead of a back link inside the page, and every step is clickable. The session an automation run spawns its agent into now sits under that run too, rather than looking like one of your own worktrees.

### Patch Changes

- Updated dependencies [844011e]
  - @argus/peacock@0.15.0

## 0.45.0

### Minor Changes

- b96c96b: Failed automation runs can now be dismissed from the inbox and from home, the same way proposals can.

### Patch Changes

- ca63787: Resuming a stopped agent from the phone now brings back the whole conversation instead of opening an empty chat.

## 0.44.0

### Minor Changes

- 17ac97d: Show iOS simulators the right way up: the device view now follows the device's orientation, and follows a foldable to whichever screen is lit. Adds Rotate and Fold buttons to the device toolbar.
- 4daf453: New built-in automation: Local branch cleanup. Weekly, it finds the local branches whose pull request already merged and whose remote is gone, and proposes each one for deletion with the exact command to run. Off by default, like every built-in.
- 51d87de: The phone gets an inbox: read what your automations are proposing, start the work, or dismiss it with a reason. Starting one needs the control grant, same as sending an agent a message.
- 13f2c16: Home now shows what needs you: pending proposals you can start or dismiss without leaving the screen, plus automation runs that failed, with a link to the rest of the inbox.
- 66901e6: Inbox proposals now carry their own call to action. An automation that finds a PR needing a reviewer asks you to open it instead of offering to start a session with no code to write, and a proposal with nothing to act on shows only Dismiss.
- 67363d7: Home now highlights automation reports you haven't read yet and lists them first, with a count next to "Recent runs". Run history and the sidebar flag them too. Opening a report clears it, and a fresh report from the same automation retires the one before it.

### Patch Changes

- 9c79242: Rows built on a full-width button — inbox items, list pickers, tree rows — now line their content up on the left instead of floating it in the middle.
- b1600ee: Sharing an agent now tells you what's missing before you start, and explains any failure with the reason and the steps out of it instead of a raw error. A missing `cloudflared` comes with the install command ready to copy, and a half-set-up Tailscale points at the checks that fix it.
- 66901e6: Inbox rows now line up on the left instead of floating in the middle of the row.
- 17ac97d: Fix the Home button and keyboard input doing nothing on iOS simulators.
- 51d87de: The phone marks an automation report read when you open it, and dots the ones still waiting — the same unread state your Mac shows.
- Updated dependencies [b1600ee]
  - @argus/peacock@0.14.0

## 0.43.0

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

## 0.42.0

### Minor Changes

- 84703d5: Update the bundled conductor CLI to v0.31.0.
- 64f38e0: Manage a project's branches from the phone: a new Branches screen switches, creates, and deletes branches, offering to stash or discard when uncommitted changes block a switch and confirming before dropping unmerged commits.

### Patch Changes

- 5d18ded: Redesigned the lock screen in the mobile app with a watching-eye mark and a Face ID / Touch ID unlock button.
- b8806bb: The mobile image viewer now supports pinch and double-tap zoom, panning while zoomed, and swipe-down to dismiss.
- 28d3f36: Messages sent with linked projects from the phone now show project chips instead of the raw linking text.
- d814c20: Links in mobile transcripts are now tappable inside bold text and headings, keep trailing punctuation out of the URL, and no longer look like links when they point at something the phone can't open.
- 9ff6b00: The mobile agent screen's stop button is now labelled "Shut down agent", and its confirmation no longer claims the agent is mid-turn when it's idle.
- 5d18ded: Image attachments in chat messages now have a subtle outline so they stand out from the background.
- f7f9395: Recent agents on the phone now list the ones needing input or still running before idle and finished ones.
- 741ed1a: Agents waiting on you now stand out in the phone and browser clients: rows blocked on a permission prompt, a question, or a plan approval are badged and sorted to the top instead of looking idle.
- 43f5a5d: Fix worktrees getting stuck on "initializing" after a setup command like `pod install` finished successfully. Setup commands now run in a shell whose line editor can't garble them, and a setup command that goes silent for 20 minutes fails with an error instead of hanging forever.
- Updated dependencies [5d18ded]
- Updated dependencies [43edb2d]
  - @argus/peacock@0.12.3

## 0.41.0

### Minor Changes

- d711ff2: You can now switch a session's runner from the model picker until the first message is sent — in the start-agent dialog and in a fresh chat. The picker also lists the runner's own models instead of Claude's.

### Patch Changes

- aa89e70: Signing in to MCP servers that only accept known clients — Figma among them — now works instead of failing with a registration error.

## 0.40.2

### Patch Changes

- 9ba72af: Messages queued from the phone or web client now continue automatically when the agent's turn ends, even if that chat isn't open on the desktop.

## 0.40.1

### Patch Changes

- 6741e02: On the phone, the chat input now sits exactly on top of the keyboard and the newest message stays visible when the keyboard opens.
- 6833c55: Your phone and browsers stay quiet while you're working in a focused Argus window — notifications only reach them once you've stepped away. Turn on "Notify my devices while I'm using Argus" in Settings → Remote access to get them regardless.

## 0.40.0

### Minor Changes

- e812ef1: Messages you queue up for a busy agent now live on your computer instead of in whichever client you typed them into. Reloading the web client or reinstalling the phone app no longer throws the queue away, and the same queue is visible and editable from all three.
- e812ef1: A round of fixes to the phone and web clients: tapping any image now opens a full-screen viewer, images attached to a queued message are visible instead of hidden, removing a queued message or stopping an agent asks first, scrolling a chat puts the keyboard away, you can jump to a running device from inside a chat, and the "Connected" label in the header is now just a small dot.
- e812ef1: The mobile app can now look back at agents that have already finished: each project lists its recently stopped agents, opens their full transcript, and can pick the conversation back up in a new agent. Long runs of tool calls also fold into a single line you can tap open, instead of scrolling past every one.

### Patch Changes

- e812ef1: Pasting an image into the mobile message box now works: use the keyboard's own Paste action instead of a separate paste button.
- e812ef1: You now get a notification when an agent asks you a question or puts a plan up for approval. Previously these only reached you if the agent also happened to need permission, so in auto mode they waited silently.
- b9ce61b: Fixes three things in the mobile app: notifications about different events no longer replace each other on the lock screen, tapping a pushed notification now opens the agent it came from, and the keyboard no longer covers the message box.
- b919a71: Background push settings are down to a single switch. The Apple and Firebase credential fields are gone — notifications go through the Argus relay, which holds those credentials, so there was never anything to fill in.
- e812ef1: A chat resumed or forked on the desktop no longer shows up empty in the web and phone clients until you send a message.

## 0.39.0

### Minor Changes

- c2680dd: Phone notifications no longer need any setup. Argus encrypts each one for your device before it leaves your machine and sends it through a relay that only ever handles the ciphertext — it can't read your notifications, and it won't deliver one unless your phone authorised the sender. Browsers are still reached directly.
- 1096d49: The Argus Remote mobile app now uses the Argus app icon on the home screen, including an adaptive and themed icon on Android.
- 080f717: The Argus Remote phone app can now be paired with several computers. Its new home screen lists every paired computer with its connection state, connects to whichever one you tap, and lets you rename or unpair them.
- 918142e: Approval notifications now carry Approve and Deny buttons — on the macOS banner, on your phone, and in the browser. Answering from the button sends the decision straight to the agent without opening anything, and it still works if you tap it while offline: the answer is queued and delivered as soon as you reconnect.
- 918142e: Argus can now wake your paired phone with a real notification when an agent finishes, fails, or needs approval — even with the app closed. Add your Apple and/or Firebase push credentials under Settings → Remote access; the notifications go straight from your computer to Apple or Google, with no Argus server in between.
- 918142e: The web client can now notify you after you close every tab. Turn on Background push in its settings — your computer signs and encrypts these itself, with no Argus server in between and nothing to configure. Needs an https address, so use a tunnel rather than a plain LAN one.

### Patch Changes

- 080f717: You can now attach a copied screenshot to a message in the mobile app. A paste button appears next to the camera whenever there's an image on the clipboard.
- 1b4e7d3: Backing out of a chat in the web client now returns you to the top of the home screen instead of leaving it scrolled down.
- d08c489: Zed now shows up in the "Open in" list when it's installed.
- Updated dependencies [e0c539b]
  - @argus/peacock@0.12.2

## 0.38.1

### Patch Changes

- e1be735: Give each Claude account its own CLI identity so agents stop failing with "OAuth session expired and could not be refreshed" after switching accounts. Accounts whose credentials stop working now show as Signed out in Settings with a Sign in again button.
- 38d7e3e: Fix custom runners being ignored: the runner picked in the new-session dialog (and the default runner set in Settings) is now actually used for the session, and switching runners resets the model to that runner's own default.
- Updated dependencies [e1be735]
  - @argus/peacock@0.12.1

## 0.38.0

### Minor Changes

- 63b097f: Add custom runners: point Claude Code at another Anthropic-compatible endpoint (like callstack.ai's Apex) from Settings → Custom runners, then pick it per session or as your app default. Start from a template, paste your API key, and the runner's models show up in the model picker.

### Patch Changes

- e33950f: Run commands now pick up version managers configured in your shell rc file, so tools like `bundle`, `ruby`, and `node` resolve to the same versions you get in a terminal.

## 0.37.2

### Patch Changes

- 40bae7e: Run commands now pick up environment variables from your shell config (like `ANDROID_HOME`) while still being parsed exactly as written.

## 0.37.1

### Patch Changes

- f9a383e: Run commands now execute in your login shell, so environment variables from your shell config (like `ANDROID_HOME`) are available to builds.

## 0.37.0

### Minor Changes

- 517e705: The conductor version setting is now a dropdown of published versions instead of a free-text field. Only releases at or above the version bundled with Argus are offered.
- fa93f33: Floating device windows open again instead of showing a blank screen, and any device can now be detached — Android emulators and video inputs such as capture cards, not just iOS simulators.

### Patch Changes

- 787f1e9: Video inputs stay selected in the devices grid when you navigate away and come back.
- fa93f33: Marking a failed session as ready now starts its agent with the original prompt instead of doing nothing.

## 0.36.0

### Minor Changes

- 708322f: Device UI inspection is now Apple-only and reads the running app in-process for
  much richer detail — real class names, resolved colors and fonts, text, and the
  full view/layer tree — instead of the accessibility-only snapshot. The Inspect
  mode only appears for iOS/iPadOS/tvOS runtimes. If the app isn't set up for
  inspection, Inspect now offers one click to restart the running app with it
  enabled, or — on the home screen — a picker to launch any installed app with
  inspection. Selecting an element lets you live-edit its text, colors, alpha,
  visibility, corner radius, and border right on the device. Adds a ColorSwatch
  component to the design system.
- 042d55c: Removed the embedded file editor panel. ⌘-clicking a file link now opens the file in your default app.
- bc1f694: Slash commands now show an inline argument hint in the message input once you pick a command, so you know what to type next.

### Patch Changes

- f1126d7: Anchored dropdowns (run commands, runtime picker, runtime links) no longer close when unrelated parts of the app scroll, such as the agent chat auto-scrolling on a new message.
- 655983f: Fix a crash ("Cannot read properties of undefined (reading 'matchAll')") that could take down the whole chat view when a message or tool-call block had no text.
- 1dc015c: Fix `get_agent_result` refusing to return a finished agent's result when the agent had completed its turn but its process was still alive (status "idle").
- d9f1fac: Background Explore/Plan subagents no longer stall on permission prompts that never appeared, and their final results now show up in the conversation even when they finish many turns later.
- b4f5811: The running spinner on a sub-agent tool call now shows on the left where the status dot sits, instead of beside the agent name.
- Updated dependencies [f1126d7]
- Updated dependencies [708322f]
  - @argus/peacock@0.12.0

## 0.35.1

### Patch Changes

- 16685a0: Agents no longer claim a web browser view is attached when the runtime panel has none open. They're now told the project targets the web and a browser can be opened, instead of being pointed at a non-existent view.

## 0.35.0

### Minor Changes

- 71b0109: Pin a specific conductor CLI version from Settings → Tools. Argus installs it on demand and uses it for all device interaction — no app update needed. Leave it blank to use the bundled version.

## 0.34.0

### Minor Changes

- e31f28e: Add a tile-size slider to the Devices grid view so you can scale the live device tiles up or down.
- e31f28e: Watch several devices at once with the new grid view on the Devices screen. Pick devices to tile them side by side as live monitors, and flip any tile to interactive to tap and type on it. Multiple Android emulators can now stream at the same time, alongside iOS, web, and video devices.
- 21fc45e: Stay signed in to several Claude accounts at once and switch between them from Settings without logging out. Sessions can be pinned to a specific account, so work can keep running on another account when one is rate-limited.

### Patch Changes

- e31f28e: Android emulator previews now start promptly even when the device screen is idle, instead of hanging on "Starting capture…" until something on screen changes.
- e31f28e: Updated conductor to 0.24.0.
- Updated dependencies [fcee84e]
  - @argus/peacock@0.11.0

## 0.33.1

### Patch Changes

- d16da67: Updated conductor to 0.23.0.

## 0.33.0

### Minor Changes

- 7d3f24d: Android emulator mirroring is now much faster to start and more responsive. Emulators stream over the emulator's native interface instead of scrcpy, so there's no server push on connect and taps and keystrokes land with less delay. Physical devices continue to use scrcpy.
- eaeea3f: Mermaid diagrams in chat now have a toggle to switch between the rendered diagram and its raw source, plus a copy button so you can paste the diagram into other docs.
- eaeea3f: Adds secure remote access: pair a phone or a browser on your network and monitor your projects and agents from anywhere, and approve or deny agent permission prompts remotely. Argus exposes a local, end-to-end-encrypted gateway through a Cloudflare or Tailscale tunnel — or, on your own Wi-Fi, serves a web client directly with no tunnel at all. There are no inbound ports, and paired devices monitor and approve prompts by default. Set it up under Settings → Remote Access, or the Remote access button on Home.
- eaeea3f: Remote devices you grant control can now drive agents like the desktop — send messages and images, interrupt, switch model, permission mode, and reasoning effort, use slash commands and @-mentions, start new agents, and create new sessions. Control is opt-in per device (toggle it when pairing or later under Settings → Remote Access); other devices stay monitor-only, and creating projects always stays on this machine.
- eaeea3f: The remote web client can now view and control connected simulators and emulators from your phone: browse booted devices, watch their live screen, and tap, swipe, type, and press hardware buttons. Screen control requires a device paired with control access.
- eaeea3f: Remote web client: control devices can now stop agents and rename or delete sessions and branches, and any paired device can review a session's git status and the diff of what an agent changed (branch or working-tree) right from the browser.
- eaeea3f: The remote web client now shows notifications when an agent finishes, needs approval, or sends a push — the same alerts you get on the desktop. Enable them from the web client's Settings screen.
- 0091b4a: An agent that has delegated to a Claude subagent (Task/Agent tool) now keeps showing as running while that subagent works, instead of appearing idle. You can still send it a new message in the meantime.
- 7d3f24d: Connected capture cards and cameras now show up as devices you can watch live. Pick one from the runtime target picker's new Video Inputs section, or open it from the Devices list, to see its picture. It's view-only.
- eaeea3f: The remote web client now mirrors the desktop chat faithfully: markdown, per-tool rich rendering, edit/write diffs, embedded images the agent read, nested sub-agent activity, and task/todo lists — all read-only. The chat presentation layer is now shared design-system components, so the desktop and web views stay in sync.
- eaeea3f: The remote-control web client now shows the context-window usage meter next to the model, matching the desktop, so you can see how full the agent's context is from your phone.
- eaeea3f: Permission prompts in the remote web client now render inline in the transcript, exactly like the desktop — including the interactive AskUserQuestion form and plan approval — instead of a separate raw prompt card at the top. You can pick answers, send plan feedback, or allow/deny right where the tool call appears.
  </content>
- eaeea3f: You can now queue messages to a busy agent from the remote-control web client — type while it's working and the message is held, then sent automatically once the agent goes idle. Queued messages show in the transcript and can be removed before they send.
- eaeea3f: The remote web client gains a settings screen where you can name the device, switch between light, dark, or system appearance, and unpair. The chosen name now shows in Argus under paired devices, and a device that's currently connected shows a live "connected" indicator there instead of always reading "never connected".
  </content>
- eaeea3f: The remote web client now matches the desktop app's look: the top nav bar, projects list, and agents list all use the shared design-system components — colored project folders, section headers, and status-dotted agent rows — instead of the previous plain cards.
  </content>
  </invoke>

### Patch Changes

- 182db2c: Signing in to your Claude account now finishes automatically once you approve access in the browser — no need to copy a code back, and the Settings panel updates on its own.
- 4b145ae: A failed Mermaid diagram no longer leaves a stray "Syntax error" graphic at the bottom of the app that pushed the whole layout up.
- eaeea3f: Harden remote control security: approving an agent's tool prompts now requires granting a device the "control" role (not just "monitor"), remote devices can no longer switch agents into unattended bypass-permissions mode, and remote file browsing and session access stay confined to your registered projects. Also caps unauthenticated connections and pins the diagram renderer's sanitizer.
- 86e10d1: Approving a plan now returns the agent to the permission mode it had before entering plan mode instead of dropping to "Ask".
- eaeea3f: Session cards now share one design-system component across the desktop sidebar and the remote web client, so both render the same icon, badges, and diff stats. The remote web session list picks up the desktop's colors and styling instead of its previous grey, hand-rolled look.
- ba73057: Updated conductor to 0.22.0.
- Updated dependencies [eaeea3f]
- Updated dependencies [7d3f24d]
- Updated dependencies [eaeea3f]
- Updated dependencies [eaeea3f]
- Updated dependencies [eaeea3f]
  - @argus/peacock@0.10.0

## 0.32.0

### Minor Changes

- c6f4ff4: Mermaid diagrams in agent messages and plans now render as interactive diagrams inline, with an expand button to open them in a zoomable, pannable viewer.

## 0.31.0

### Minor Changes

- 8115076: You can now attach images directly from the Agents panel's empty state — paste, drag and drop, or use the attach button to start an agent with images, without opening the Advanced dialog first.
- 6c95e86: The reasoning-effort picker now offers Ultracode — extra-high effort plus standing workflow orchestration — matching the Claude CLI.

### Patch Changes

- 70ec572: Fix the context-usage indicator showing a 200K limit for 1M-context models after resuming an agent.
- 8b9acaf: Updated conductor to 0.21.0
- b2acd49: Long agent conversations now load the most recent messages first and reveal older ones as you scroll up, keeping chats with thousands of messages responsive.

## 0.30.0

### Minor Changes

- e5400b6: Spawned agents are now correctly linked to the agent that created them. Parent-child relationships are tracked automatically, so delegation between agents shows the right lineage without manual setup.
- 963395a: You can now sign in, sign out, and switch Claude accounts from Settings → Claude account, without dropping to a terminal.
- feaa15a: Update Conductor to 0.20.0

### Patch Changes

- 874bb82: Fix the permission mode dropping to Ask after approving Exit Plan Mode. The restore now reliably lands after the plan exit, so agents launched in Auto stay in Auto.
- 1373d96: Correctly detect the 1M-token context window for newer models like Opus 4.8, so the context usage indicator no longer reports against a 200k limit.

## 0.29.0

### Minor Changes

- 0d20aa2: Update Conductor to 0.19.1

## 0.28.0

### Minor Changes

- 850e660: Update Conductor to 0.19.0

### Patch Changes

- 5ef2b41: Left sidebar now has a fixed pixel width by default and stays put when the window resizes. Drag the divider to resize it.

## 0.27.1

### Patch Changes

- a197aef: Restore the agent's previous permission mode after approving Exit Plan Mode. Agents launched in Auto no longer drop to Ask after planning, so you stop getting prompted for every edit.

## 0.27.0

### Minor Changes

- d1c573e: Agents can now send native OS push notifications. Use it when an agent is monitoring something (a build, a deploy, a watched process) and you want to be alerted even with the Argus window in the background — clicking the notification jumps straight to the agent's tab.
- 39a1aa8: Remove the global session launcher and its area-screenshot snapping window.

### Patch Changes

- dfcf1b9: Your default permission mode now applies to every new agent at spawn, not just prewarmed ones, so agents no longer fall back to prompting for every action. New agents now default to Auto mode, and the setting moves between Auto, Ask, Plan, Accept edits, and Trusted.
- 81f545f: Fix the first agent in a new session sometimes exiting with an error right after spawning.
- 40b698a: Clearing the agent task list now sticks across the next turn instead of having the previous tasks reappear.
- c288b84: Fix duplicate entries in the agent task list when Claude updates a task it just created — they now show the real task subject instead of appearing as a separate row labeled with the task id.
- ce61875: When the agent updates a task after you've cleared the task list, the original task is now restored with its real subject instead of reappearing as a bare id.

## 0.26.0

### Minor Changes

- 997c3a4: Show a live task list in the agent panel when Claude uses the new TaskCreate, TaskUpdate, TaskList, and TaskGet tools, alongside the existing TodoWrite list.

## 0.25.0

### Minor Changes

- b3e20f7: Forking a chat now asks whether to spin up a new session (fresh worktree) or a new agent in the current session that shares the workspace.

### Patch Changes

- 7fdc8f5: Fix a bug where editing the most recent message after cancelling the agent could make Claude lose the previous turn, picking up as if it had ended one turn earlier.
- 0d31898: Fix Auto permission mode prompting on simple edits and bash calls. Prewarmed Claude subprocesses now start in Auto mode so the CLI flag is set at spawn — runtime switches to Auto from the default mode aren't honoured by Claude Code.
- d7e3676: The branch switcher dropdown now flips above the trigger when there isn't enough room below it, so it no longer gets clipped by the window edge on the bottom-most project.
- 24c4426: MCP session and orchestration tools (`trigger_run`, `spawn_agent`, `merge_session`, `session_diff`, and the rest) now require a `project_path` argument. This stops a branch or display name shared across projects from silently resolving to the wrong project's session.
- 8c15541: Fix MCP `list_sessions` returning the wrong project's sessions when an agent in a multi-project setup omitted `project_path`. Calls without `project_path` now error out when more than one project is registered instead of silently defaulting to the first.
- 0d31898: Fix agents occasionally appearing in an immediate error state when starting. A prewarmed subprocess could be discarded mid-claim if the user navigated away, killing the just-claimed agent.
- 0d31898: Fix worktree setup commands not picking up mise / asdf / rbenv shims. Setup now runs in the user's shell so rc files load — previously it used a bare `/bin/sh`, which fell back to the system Ruby/Node.

## 0.24.2

### Patch Changes

- 81dcbc9: The renderer's 5-second git-status safety poll now skips sessions without an attached agent — idle workspaces rely on filesystem events instead of constant shell-outs.

## 0.24.1

### Patch Changes

- 519afe0: Argus no longer polls `git diff` every 2 seconds for sessions without an active agent. Idle workspaces with many sessions now stay quiet instead of running a constant fan-out of git subprocesses.

## 0.24.0

### Minor Changes

- 04c709c: The branch view now shows a split graph next to commits when a branch has diverged from its upstream, matching the visualization used in the history view.

### Patch Changes

- ee62a98: Debug log streams now fully terminate when stopped or when Argus quits, preventing leaked `simctl` processes.
- 2c1332d: Argus now keeps at most one Claude subprocess warmed up — for the currently selected session — instead of one per ready session. Avoids tens of idle subprocesses consuming gigabytes of memory in workspaces with many sessions.
- f7e7aea: Prewarmed agents are no longer counted in the menu bar tray agent totals.

## 0.23.0

### Minor Changes

- 19775c5: Session home screens now show an Active agents panel listing the agents running in that session, so you can jump straight to one without opening the chat panel.
- ba01c8c: Orchestrator agents can now create a session and spawn an agent in it with a single `create_session` call by passing a `prompt`. The call waits for setup to finish, then starts the agent and dispatches the prompt — replacing the common `create_session` + `spawn_agent` pair.
- 5d3eeb7: Interactive rebase (squash, fixup, reword, drop) now works from session worktrees, not just the project root.
- 00cebe1: Reasoning effort is now remembered between agents — once you pick a level, new agents on the same runner start at that level by default.
- 804b778: Drag and drop sessions in the sidebar to reorder them within a project.
- 8174e24: Telemetry now has three levels: off, "just count me" (a single anonymous pageview per launch — no usage data, no errors), and full analytics. Pick during onboarding or change any time under Settings → Privacy.

### Patch Changes

- b3ee3bf: Fix agent subprocesses lingering after sessions end. Argus now SIGKILLs claude children that ignore SIGTERM, tears down all live agents on quit, and reaps orphans from previous runs at startup — so CPU and memory don't drift up over the day.
- 0cd1cff: Fix branch pickers showing a stray "+ " in front of branches checked out in another worktree, which made selecting them fail with "invalid upstream".
- faca54c: Fix ⌘-click on `@`-mentions in chat: paths with backslash-escaped spaces (e.g. dragged from Finder) and trailing balanced parentheses now link to the full path instead of stopping at the first space or closing bracket.
- 472882b: Queued messages now show linked projects as chips, matching how sent messages render — no more raw "[Linked project directories — …]" preamble text.
- b65f806: Reject remote-qualified base branches (e.g. `origin/main`) when setting a session's base or merging. Previously, merging a session whose base was a remote ref would silently create a bogus local branch literally named `origin/main` instead of updating the real base.
- 9b4d0b0: Fix the session home screen getting stuck in a "Deleting…" state after a merge-and-delete. Switching to another session now shows its own state immediately, instead of carrying over the previous session's delete button.
- e413b63: Auto-disconnect simulator captures left running after the device view is dismissed. The native bridge stays alive for 10 minutes so reopening the view reuses it instantly, then shuts down on its own if nothing reconnects.

## 0.22.0

### Minor Changes

- 642bdaa: Project roots sitting on a protected branch (e.g. `main`) now fetch from origin in the background and surface their ahead/behind status in the sidebar — so new sessions don't get created on top of a stale trunk.
- a428da7: The new-session dialog now offers `origin/*` branches as the source for a fork. When the project root has a protected branch like `main` checked out, the dialog defaults to `origin/main` instead of the local copy so the new session always starts from the authoritative remote tip.
- 670da55: Retry failed session setup directly from the home screen — a new Retry button on the "Setup failed" banner re-runs the configured setup commands without recreating the session.
- 3ef438a: Squash, delete, reset, revert, cherry-pick, and other history-rewriting commit actions are now available from the right-click menu in a session's branch view, matching the project-level git view.
- e80de90: Commits in the git timeline now show ahead/behind arrows again (decorations were missing from `git log`, so the indicator silently disappeared), and the session-scope sidebar surfaces an ahead/behind count next to the Branch row. The unused History entry has been removed from the session sidebar.

### Patch Changes

- 2e7eede: Sessions whose base branch is protected now show their branch diff against `origin/<base>` instead of the local copy, so the file list reflects what a pull request would actually contain even when the local base branch is out of date.

## 0.21.0

### Minor Changes

- 886750b: Open Pull Request dialog now pre-fills the description from your project's PR template, and adds an Auto-fill button that drafts the body from your session's commits and diff.
- 5002a14: Switch the agent's reasoning effort directly from the chat input — a new pill next to the permission mode lets you pick between low, medium, high, extra high, and max for models that support it.

### Patch Changes

- 4cff062: Orchestrating agents now know that newly-created sessions take time to provision and won't immediately show their spawned agents — preventing duplicate worktrees from premature respawns after a flaky MCP transport.
- 672263d: Right-align the boot icon next to the other toolbar buttons in the device runtime view.
- 0003310: Chat messages now mark as read whenever the chat is open, instead of waiting for them to scroll into view. Opening a chat clears its unread state, and any new turns that arrive while you're already in the chat clear immediately too.
- 4d10690: Escape spaces in file and folder paths dropped onto the chat input so the resulting `@`-mention links stay intact.
- 2ce69f8: Fix the Force Push checkbox in the Push dialog unchecking itself, and clarify its wording so it matches what force-pushing actually does.
- b8df050: Fix opening pull requests failing with an `unknown flag: --json` error from the GitHub CLI.
- 02ea2c0: Remove the "Mark as unread" action from individual chat messages.
- ceedafc: Reuse existing terminal tabs when a run command's required dependency restarts, instead of opening a duplicate tab next to the stale one.
- Updated dependencies [2ce69f8]
  - @argus/peacock@0.9.1

## 0.20.0

### Minor Changes

- eb9e89b: Add chat checkpoints. Each user message now snapshots the worktree before the agent runs, and a "Restore" action on the message reverts files and rewinds the chat to that point — the original prompt is dropped back into the input so you can edit and resend.
- 5089470: Press Cmd+T while a terminal is focused to open a new terminal tab.
- 3957f5c: Right-click any commit in the git history to delete it from the branch. Works on HEAD and any earlier commit, replaying later commits on top.
- cc9f24e: Argus's device tooling — recording, control, debug streams, and the UI inspector — is now organised as togglable tools. Pick which ones you want during onboarding (or in Settings → Tools) and turn off the rest to keep the UI focused on the tools you actually use.
- 345b1f9: Wire up the previously inert git keyboard shortcuts: Cmd+Shift+U pushes, Cmd+Shift+P pulls, Cmd+Shift+F fetches, Cmd+R refreshes the working copy, Cmd+Shift+S saves a stash, Opt+Cmd+Shift+S applies the latest stash, Cmd+Shift+Opt+L opens the stash dialog, Space toggles staged on the focused file, and Delete discards it.
- eb3c2d1: The Argus MCP `read_agent_transcript` tool now supports paging through long transcripts via `head_messages`, `offset`, and `limit` (in addition to the existing `tail_messages`), and reports `start_index`/`end_index` so agents can fetch the next slice.
- cb5ab6c: When an agent triggers a run command via MCP, the resulting terminal now appears in the bottom panel just like a manually-pressed Run, so you can watch the dev server (or whatever was started) live instead of only seeing it via `read_terminal`.
- 9abb040: Close a terminal tab or agent tab by middle-clicking it.
- 8277b90: Onboarding now has a Back button on every step after Welcome, so you can revisit earlier choices without restarting the flow.
- d33eb7b: The onboarding plugin picker now groups related plugins (e.g. Device) into one card. Toggling the group enables every plugin inside; expand the card to opt out of individual plugins.
- 205a1ee: Pushing a branch now opens a dialog with options for remote, upstream, force-with-lease, tags, and ref override — including from agent worktrees and from the branch context menu.
- 6d746f9: Reworked release channels. The Update channel setting now offers **Production** (the public releases) and **Beta** (in-development builds of upcoming features). One-off alpha builds from feature branches are no longer subscribable in-app — collaborators install them manually from the GitHub release page.
- dc35106: Remove the Review Queue screen and its sidebar entry. Use the per-session merge view instead.
- 3af3b8f: Show an active agents overview on the project home screen, with a row per running agent that jumps straight into the agent's chat.
- bd3335e: Session git history and branch views now show ahead/behind arrows on each commit. When the session branch hasn't been pushed yet, sync state is computed against the base branch's upstream so unpushed work surfaces as ahead and new base-branch commits surface as behind.

### Patch Changes

- eeee88a: Reliably mark chat messages as read once they scroll into view, only flag a chat tab as having unread messages when the agent has finished working, drop the trailing ellipsis on a truncated tab title when the unread dot is showing, and add a "Mark as Read" entry to the agent tab context menu.
- b3b285b: Mark unread chat messages as read when they sit inside a collapsed tool-call group that scrolls into view.
- 08ff5d8: Hovering a collapsed tool-call group in the agent transcript now reveals the time range of the grouped messages.
- e98b4c2: Align commit dates in the history list whether or not the ahead/behind arrow is shown.
- 5f0944d: Long lines in the git diff view now soft-wrap instead of forcing horizontal scrolling.
- 3d881e7: Editing a short chat message now grows the bubble horizontally as you type instead of wrapping every word inside a narrow box.
  </content>
- 79f969b: Fix terminal subprocesses leaking on app shutdown — node-pty spawn helpers no longer reparent to launchd and accumulate across Argus restarts.
- 12e442e: Fix a render loop that crashed the tool rail when plugins were enabled.
- 7330f9c: Fix `fixup!` autocomplete in the commit composer to suggest only commits on the current branch, instead of including commits from other branches and stash entries.
- 92de525: The git view now shows a friendly placeholder while a session is still initializing instead of erroring out.
- 20102f7: Stop the global launcher from yanking you back to Argus's Space when summoned over a fullscreen app, and stop it from re-showing the main window the first time it's triggered. Change the default shortcut to ⌘⇧? and let you record a custom one in Settings → Session launcher. The double-tap right Option binding (and its Accessibility prompt) has been removed.
- 1544c36: Project MCP servers in the Project settings dialog now render in the same card layout as inherited servers, with a connection status bulb and the advertised tool list when probed.
- 0846c06: Mark visible unread chat messages as read when opening a chat, including messages that sit inside a collapsed tool-call group.
- e258c7e: Add Claude's new smart Auto permission mode (auto-approves safe actions, asks for risky ones) and a separate Ask mode for the previous "ask before every write" behavior. Shift+Tab now reliably cycles through Auto, Ask, Plan, and Accept Edits — Trusted stays available in the picker but is skipped by the keyboard cycle since it cannot be enabled on a running agent.
- cbfff41: In the pull requests list and detail view, if a session for the PR's branch already exists, the "New session" button is replaced with "Open session" that jumps straight to it.
- 417283c: Fix the onboarding Preflight step and Settings → Plugins prereq list crashing with an infinite update loop.
- d08501d: Fix popout windows failing to render correctly on release builds because their bootstrap script was blocked by Content Security Policy.
- b9c72b9: Remove the redundant "Native sim bridge" preflight check. The bridge ships inside the app bundle, so the check always passed in release builds.
- f0b9754: Open projects and sessions on their Home tab even when navigating from another screen that was on Agents.
- c53398c: Default to a session's Home tab instead of Agents when opening a project or session.
- edd059b: Carry the prompt over when opening the advanced Start agent dialog from the empty agents view, and keep edits in either place in sync.
- 9e072b0: Stop loading user-level Claude Code settings when generating session and chat titles, so a large user CLAUDE.md or memory bank no longer pushes the prompt past Haiku's input limit.
- 75b7e95: When a session against a protected branch already has an open pull request, the home screen now shows a "View PR" button that opens it on GitHub instead of offering to open another one.
- e0c66da: Fix `wait_for_agent` and `wait_for_any_agent` hanging on children that have already finished. The CLI doesn't always emit a final `session_state_changed(idle)` event (it can race with the `result` event or be skipped entirely for text-only responses), so the turn counter could stay at zero on a child that was clearly done. Orchestrator waits now key off the authoritative `result` event and resolve as soon as any waited-on child completes.
- Updated dependencies [a5d5448]
  - @argus/peacock@0.9.0

## 0.19.0

### Minor Changes

- ba0eee0: The Agents view now shows a focused launcher when no agent is running — type a prompt and hit ⌘↵ to spawn an agent in one step, instead of repeating the Home screen.
- 8b07008: When the commit history contains `fixup!` or `squash!` commits with matching targets on the current branch, a banner now offers a one-click autosquash to fold them in.
- 88c23da: The project branch switcher now groups branches by priority — current, protected (main/master/staging/develop and project-configured), branches matching your personal prefix, then everything else — and hides branches already checked out in another session.
- 7d997fb: Settings now has an LLM section where you can pick the default runner and model used for new sessions. Today Claude Code is the only registered runner; the model field is optional and falls back to the runner's default.
- 52a2383: Removed the "Defaults" onboarding step. Git identity is collected inline in Preflight when missing, and the default Claude model is now editable under Settings → Agents.
- fa20b22: Home is now a session-level tab alongside Agents, Editor, and Git instead of a tab inside the agents bar, and each tab now shows a leading icon.
- 0c5acf9: Pick from all four runner permission modes (Auto, Plan, Accept edits, Trusted) when starting an agent or while a conversation is running. The chat input replaces the binary Plan toggle with a chip that opens a mode picker, and Shift+Tab cycles through modes without leaving the keyboard.
- 4aa2277: Preflight now installs missing tooling on your behalf. The Claude CLI, Playwright browsers, the iOS simulator runtime, and the native sim bridge all gain an Install button, and missing git identity is collected via an inline form instead of a copy-paste command.
- 7d997fb: Project settings now include an LLM section where you can pin the default runner and model for everyone working in the repo via `.argus.json`.
- dc7554f: `setup.copy` and `setup.symlink` entries can now be objects of the form `{ "path": ".claude", "exclude": ["projects/**/worktrees/**"] }` to prune subdirectories from the copy/symlink expansion. Bare path strings still work — useful for keeping `.claude` cached without dragging Claude Code's per-session worktrees from the source branch into every new session.
- 1f1fdaa: Squashing selected commits no longer requires the selection to be contiguous. Non-selected commits in between replay on top of the squash; if that conflicts, the rebase is aborted and the error surfaced. Cmd-clicking an already selected commit in the git history now deselects it.
- e0de455: Chat now shows a single "Unread" divider above the first unread message instead of marking each message individually. The divider clears as soon as you scroll past it, and the hover "Mark as unread" action moves it back to that point. Agent tabs, session cards, and project cards still show an accent dot when any of their agents have unread messages.

### Patch Changes

- c89c11c: Amend now works on pushed commits without a confirmation prompt or backend block. Force-push policy is left to your remote's branch protections.
- 304c032: Fix AskUserQuestion answers that contained commas or free-form text being shown as "No answer" after submission. Selected option labels are now matched by substring scan rather than comma splitting, and any free-form note is rendered alongside the picks.
- e10ce39: AskUserQuestion now lets you switch from a selected option back to the free-text answer. The custom answer field has its own radio button, so picking it deselects other choices (and vice versa).
- 3a82e5a: Preserve in-progress answers and plan feedback when switching agents or views. The free-text inputs in AskUserQuestion and ExitPlanMode prompts no longer reset to empty when you navigate away and come back.
- 09f373e: Discarding a staged hunk now also removes it from the index, so the merge-conflict button no longer lingers after you discard your conflicting changes.
- 5820efe: Fix the running indicator disappearing after editing the last message in a chat. The agent restart triggered an exit event that flipped the indicator to stopped before the new run could light it up again.
- e1e00b7: Forking a session no longer shows a duplicate row in the sidebar, gets stuck in "initializing", or starts the new agent with an empty conversation. The fork's reset, working-tree replay, and conversation truncation now run after the new worktree exists, so the resumed agent picks up where you left off.
- e10ae8a: The git panel now lets you create the first branch in a fresh repo. The branches sidebar shows a "Create branch" button when the list is empty, the toolbar's Branch action opens the new-branch dialog in project scope, and creating a branch on an unborn HEAD no longer fails.
- c3d6663: Fix double-tap right Option launcher trigger in signed builds. The native helper now registers properly with macOS Accessibility so the permission prompt actually appears, and granting it makes the global hotkey work.
- df21a83: Remove the grey background behind the markdown in the proposed plan dialog so it sits flush on the dialog surface.
- 7d997fb: Project Settings now picks the LLM runner from the registered runners (matching app-level Settings) instead of a free-form text field.
- f28496d: Stale worktrees deleted outside Argus (e.g. by Claude Code's Agent tool) are now pruned automatically, so the git view no longer fails to load with a "fatal: not a git repository" error after a sibling worktree directory was removed by hand.
- 44a891e: The session options (…) button now stays pinned to the right of the session card when the title is truncated.
- 5047f18: Drop the file-count badge from session and project cards in the sidebar — only line additions and deletions are shown now.
- Updated dependencies [304c032]
- Updated dependencies [e0de455]
  - @argus/peacock@0.8.0

## 0.18.0

### Minor Changes

- d95773a: Show ahead/behind arrows next to commits in the git history when your branch has diverged from its upstream.

### Patch Changes

- 9e403af: Polish git status badges: ahead-of-base badge in the sidebar matches the height of branch badges, and ref badges no longer show a stray accent glow on the active branch.
- fded62d: Fix double-tap right Option not summoning the launcher even when Settings reported it as active.
- 766be35: Fix prewarmed Claude subprocesses appearing as active "running" agents on every session at app launch.
- ed2f3c3: Project folder badges on the home screen now keep their accent color when agents are running, instead of turning green.
- c84d114: The action buttons on the project home screen now wrap onto a new line at narrow window widths instead of overflowing.
- Updated dependencies [9e403af]
- Updated dependencies [ed2f3c3]
  - @argus/peacock@0.7.1

## 0.17.0

### Minor Changes

- 774b88c: Click an image attachment in the chat input to open it in the preview, then optionally crop it before sending.
- 5321bf3: Optional global session launcher: enable it from onboarding or Settings → Session launcher to summon a floating prompt anywhere with Cmd+Shift+Space (or double-tap right Option on macOS, with Accessibility permission). Pick a project, optionally a session (or run on the project root, or branch off a new one), type a prompt with attachments, drag-screenshot a region, and start an agent without leaving whatever you were doing. Off by default.

### Patch Changes

- 5321bf3: The global session launcher now prompts for macOS Accessibility permission the first time it starts, instead of silently failing until you find the System Settings pane yourself.
- 5321bf3: The first time you drag a region in the global session launcher, the launcher now stays out of the way of macOS's Screen Recording permission prompt instead of popping back on top of it.

## 0.16.0

### Minor Changes

- 4a29e75: Configure a `default_base_branch` in `.argus.json` (or via Project settings → Branch protection) to preselect that branch when creating a new session. Without it, Argus now also probes for `staging`, `develop`, and `dev` before falling back to `main`/`master`.
- 7021024: The Delete Session dialog now warns you specifically when a session has unmerged commits, staged changes, modified files, or untracked files that would be lost — instead of showing the same generic warning for clean and dirty sessions alike.
- 6483947: Drag and drop image files into the chat input to attach them, alongside the existing paste-from-clipboard flow.
- 5d835fa: Adds a full-featured git workspace: a sidebar for branches, tags, remotes, and stashes; a commit history graph with author avatars, refs, and inline commit details; a working copy view with multi-select staging and quick actions; drag-and-drop to reorder, squash, revert, and apply commits; an integrated commit composer with autocomplete and amend support; tools for blame, compare, image diffs, interactive rebase, auto-fetch, and pull request authoring; and a keyboard shortcut cheatsheet.
- a79d66d: Merging a session now includes all work in its worktree — committed, staged, modified, or untracked — so nothing gets left behind on the branch when you merge.
- ccfdb62: Track navigation as `$pageview` events when telemetry is enabled, so PostHog Web Analytics and DAU insights work. URLs are sanitised first — every dynamic segment (session, organisation, PR identifiers) is replaced with a placeholder before the event leaves your machine.
- d21b754: Each session now remembers which center panel (agents, editor, git, home) you last viewed it on. Switching to another session — including switching projects — restores that session's panel instead of reusing the panel from the previous session.
- 4cc2959: Added a Link button to the runtime toolbar for connected simulators and emulators. It opens a dropdown of project-configured deep links (set under `simulator_deeplinks` in `.argus.json`) and fires the chosen one into the device. Deep links can be grouped into folders, and folders may nest. The Project Settings dialog now ships a polished tree editor for the list, plus editable Deep links and Related projects sections, and the rest of the dialog has been brought up to the same polish: list items render as cards with hover-revealed delete buttons, empty states use a real illustration, Platforms toggles are interactive chips, Run command "Requires running" entries are togglable chips, Branch protection's Advanced block uses a proper collapsible, and the JSON preview shows in a code block with a built-in copy button.

### Patch Changes

- 4cc2959: Saving Project Settings now refreshes the deep links menu, run commands, and protected-branch flags immediately. Previously you had to navigate away from the project and back for the new `.argus.json` values to take effect.
- 6f0a373: Pull requests where you're only a team reviewer no longer show both "Reviewer" and "Team review" pills — just "Team review".
- a737e46: Reclaim the traffic-light gap in the title bar when the window enters macOS fullscreen.
- Updated dependencies [5d835fa]
- Updated dependencies [4cc2959]
  - @argus/peacock@0.7.0

## 0.15.0

### Minor Changes

- 8f47226: Sign in to OAuth-protected MCP servers (Figma, Linear, etc.) directly from Argus. A failed connectivity test now shows a "Sign in with browser" button when the server returns 401, walks through the OAuth 2.1 flow, and stores the resulting token securely in your OS keychain. Spawned agents inherit the bearer transparently.
- 4cedbbc: The session home screen now drives its release-notes list from a single `release_note_patterns` config in `.argus.json`. Each pattern has a `format` of `changesets`, `regex`, `json`, `yaml`, or `xml` — letting projects pick how their release notes are written and which fields show as Badges. Existing `@changesets/cli` projects keep working with no migration: when the config is empty but `.changeset/` is present, Argus auto-uses the changesets format.
- 085d0e0: Reorder run commands in Project settings with up/down arrows on each entry. The order is reflected in the run menu.

### Patch Changes

- 627d9c6: Deleting a session that failed to create its worktree no longer errors out. Argus now cleans up the leftover state instead of refusing the delete with a git "is not a working tree" message.
- 5e1a92c: The onboarding preflight check now uses a two-column grid of cards, each with install instructions or a link when something is missing. The progress indicator no longer bleeds through scrolled content.

## 0.14.0

### Minor Changes

- fe43325: The Project settings dialog now has a Personal section where you can set your branch prefix. The value is stored locally on your machine, not in `.argus.json`, so it stays personal and is not shared with the team.
- 2e0e61d: Marking a session as ready after a setup failure now also kicks off the agent with the original prompt, matching what would have happened on a successful setup.

### Patch Changes

- a395352: The play icon shown on a session with an active run command now properly turns green, and continues to indicate when an agent is also running.
- 3652a97: Required run commands now appear as their own terminal tab when auto-started, so dependencies like a Metro bundler are visible and capture output instead of running invisibly in the background.
- b795e5b: The Changes preview in the toolbar now wraps long diff lines instead of truncating them with an ellipsis, so you can read the full content of every change.
- e0f8f29: The "Check for Updates…" item in the Argus application menu now actually shows the refresh icon — previous builds rendered a blank square next to the label.
- 93f6dc9: The project header in the sidebar now shows a pulsing play icon while its run command is executing, matching the running indicator already shown on individual sessions.
- b4db57a: The Apple TV remote now stays vertically centered next to the simulator stream in the docked runtime view, and pins to the top of the enlarged dialog so it no longer stretches awkwardly.

## 0.13.0

### Minor Changes

- d80d7a6: The Platforms project setting now supports tvOS alongside iOS, Android, and Web, and its dialog description has been corrected — it narrows which runtimes the agent system prompt describes, not what gets pre-allocated (devices are acquired on demand when agents run conductor commands).

## 0.12.0

### Minor Changes

- 195d16e: Run commands now auto-start their dependencies. When you start a run command whose "Requires running" list includes another command that isn't up, Argus launches the dependency (and its dependencies) first instead of refusing to start.

### Patch Changes

- 1f2377c: Recover a session whose setup command failed without restarting the app. The session home screen now shows a "Mark as ready" button next to the failure, so you can run the failed step yourself in the terminal and then unblock starting agents.
- 6db1885: Fix renderer telemetry events (including the in-app feedback dialog) not reaching PostHog in production builds. Renderer events are now routed through the main process instead of going direct from the file:// origin.
- 9e411e3: Run command entries in the project setup dialog are now visually grouped into cards, so it's easier to tell where one command's settings end and the next begins.
- 25bff55: Apple TV remote keyboard shortcuts no longer hijack the spacebar, arrow keys, and Enter while you are typing in the terminal or another editable area when a tvOS simulator is open.

## 0.11.0

### Minor Changes

- 38861a2: Added a public documentation manifest in the Argus repo, plus three new user-facing docs (Getting started, Concepts, Features). These power a proper multi-page documentation site at houwert.dev/argus/docs covering everything Argus supports.
- e698cb4: Test MCP server connectivity right from Settings — every entry in the project, app-level, and inherited MCP lists now has a Test button that runs a JSON-RPC initialize handshake and reports latency or the failure reason.
- 73ce2ab: `.argus.json` now supports a `min_argus_version` field. When set, the project home screen shows a warning if the running Argus app is older than the required version.
- e73924e: When generating `.argus.json` during onboarding, Argus now shows a spinner while Claude is thinking and presents the proposed config for review before writing the file — discard or save instead of an automatic write.
- 73ce2ab: Run commands can now declare a `requires` list of other run-command titles that must already be running in the same session — handy when a frontend dev server needs the backend up first.
- e29f4d6: Run commands now print an explicit "exited" status line in the terminal when they finish, and active run-command tabs show a spinner icon while still running.
- 6c45b66: The macOS menu bar dropdown now nests projects, sessions, and agents in three layers, and clicking an agent jumps directly to that agent — even when you are already viewing the same session.

### Patch Changes

- 9d42389: Telemetry docs now note that the PostHog project has "Discard client IP data" enabled — the raw IP is not stored alongside events, though PostHog still uses it at ingestion to derive city-level GeoIP fields before discarding it.
- d892670: Linked project directories now appear as folder chips inside your sent message instead of a wall of bracket text.
- 4140d5a: Fix the floating simulator window opening blank.
- 119221b: Fix anonymous telemetry in production builds. Main-process events were being silently dropped because the PostHog key was only inlined into the renderer bundle.
- 631483b: Corrected the telemetry documentation to be fully honest. When telemetry is opted in, Argus now clearly discloses every property attached to events — including the standard PostHog SDK auto-properties (browser, OS, screen, timezone, in-app URL, session id) and the city-level GeoIP that PostHog derives server-side from the request IP. Previous docs incorrectly claimed "anonymous distinct id only" and "no IP address or geolocation"; that is fixed. No code change to what's collected — only the docs.
- f765db8: Session and chat title generation is now reliable and fast: it no longer loads the project's CLAUDE.md, MCP servers, hooks, or skills, so titles arrive in seconds instead of timing out and falling back to a slug.
- fba698b: Trimmed the public-facing docs to drop implementation details that don't help users — code-signing/notarisation specifics, internal source paths, library names, and contributor-only sections — while keeping every user-facing setting, the full feature catalogue, and the complete telemetry/privacy disclosure.

## 0.10.0

### Minor Changes

- cb18792: You can now add your own MCP servers from Settings (personal, machine-local) or from a project's `.argus.json` (shared with the team). They are merged with the MCP servers Argus already inherits from Claude Code, so every agent gets the full set.
- 988c5db: Add anonymous usage and crash reporting via PostHog. Argus only sees which features are used and what errors occur — never your prompts, file contents, project names, or any identifying information. New installs now choose during onboarding whether to share data; the default is off until you opt in. A "?" button at the bottom of the tool rail (always visible) opens an anonymous feedback dialog. Flip the choice any time under Settings → Privacy. Disabled in development builds.
- 09ea14c: Starting an agent or plan-mode agent now opens a full-featured prompt dialog (model picker, project linking, slash commands, file mentions, image attachments) instead of an empty tab. The new-session dialog gained the same model and project-linking controls, both forwarded to the first agent that boots in the session. New sessions are focused immediately while setup runs in the background. The in-chat TODO list shows a spinner on the in-progress item, and AskUserQuestion prompts include a free-form text field alongside the options. A new "Display size" setting in Appearance scales the whole UI between five presets (Larger Text → More Space), with a slightly larger default than before.

### Patch Changes

- bb1fecf: The Agents overview now shows session names instead of short ids, and the project link opens the project's home instead of the project picker.
- 0d459db: When an update finishes downloading, the changelog dialog now opens automatically so you see what's new alongside the restart prompt. The changelog dialog itself also has more breathing room around its content.
- 87b2808: Soften the dark theme: backgrounds are lifted from near-black to a slightly lighter slate, and primary text is dimmed from pure white to an easier-on-the-eyes off-white.
- 4423e48: Fix ⌘-clicking a file link in production builds — the editor view now reliably opens the linked file instead of switching to the editor without loading it.
- 723c261: Chat titles now generate reliably instead of failing with a "prompt too long" error.
- 14adf71: The zoom toolbar in the image viewer is now readable in light mode.
- dd01d68: Agents now keep their selected model when restarting or restoring an earlier turn, so 1M-context sessions no longer silently revert to the 200K default.
- c9e7808: Rebasing a session onto its base now auto-commits any staged changes first, so the rebase no longer fails with "Your index contains uncommitted changes."
- 7624fd2: Terminal tabs and the running indicator for run commands are now restored after reloading the Argus window, so dev servers and other long-running processes stay visible instead of becoming orphaned.
- 735f728: Fix single-runtime mode racing against the previous runtime — when stopping another session's run to start one here, Argus now waits for the old process to actually exit before spawning the new one, so dev servers no longer fail with "port already in use".
- 0bf3bbe: Right-clicking a misspelled word in chat inputs now shows spelling suggestions and an Add to Dictionary option instead of just the basic edit menu.
- 1a850f5: The notifications button now stays visible in the tool rail on the home screen, so background warnings and errors are always one click away even when no session is selected.
- Updated dependencies [87b2808]
- Updated dependencies [988c5db]
- Updated dependencies [98e243c]
  - @argus/peacock@0.6.0

## 0.9.0

### Minor Changes

- 814567f: Generating `.argus.json` from the project home now opens a dialog that explains what the file is and offers two paths: a quick local inference, or a "Generate with Claude" option that runs the Claude CLI to produce a tailored config based on your scripts, native targets, and env files.
- 90fec94: The session home now shows a live initialization status widget while a new worktree is being set up — current step, total remaining, and the file or command in flight — alongside the existing "Setup" terminal output. Adds a reusable `ProgressBar` primitive to Peacock.
- d360d89: Argus now lives in the macOS menu bar. A small icon styled after the app's ring-and-dot mark sits next to your other status items and pops open a dropdown of every running agent grouped by session — pick one to jump straight to that session in the main window. The icon switches between an outlined "all quiet" state and a filled "something's happening" state so you can tell at a glance whether your fan-out is still working, and the dropdown now stays in agreement with the agents screen instead of marking still-busy agents as idle between tool calls.
- 9aa1e90: Added a "Project settings" button to the project home screen that opens the `.argus.json` editor — no need to dig into the sidebar to tweak setup, run commands, or ports.

### Patch Changes

- bd0dee8: Auto-updates now run during onboarding so first-launch users see new versions immediately.
- 54929f8: Generated `.argus.json` no longer ships with a default empty "Shell" terminal tab or a default `ARGUS_PORT` env allocation — those are left to you to add when you actually need them.
- 23769e5: Saving project settings now keeps the trailing newline at the end of `.argus.json`.
- bdb674d: The "Check for Updates…" item in the Argus application menu now uses a refresh icon instead of a download arrow, matching what the action actually does.
- 713a8cf: Modal dialogs now overlay the entire app instead of being clipped to wherever they were triggered from, so the single-runtime confirmation no longer appears stuck inside the top bar.
- 10cbc2d: The onboarding screens now have a proper draggable title bar so the window can be moved while you're setting up Argus.
- d3dc1f3: The Cmd+Shift+O palette now lists projects above sessions, and sessions stay in a stable alphabetical order instead of reshuffling whenever a project's sessions refresh.
- ec20780: User-initiated agent starts now open the new agent automatically again. The toolbar + button, the home-screen Start buttons, recently-closed reopen, and chat-history resume all surface the new agent as active. Background agents spawned via MCP still leave the active tab alone.
- ddaab15: The run button in the center panel titlebar now prioritizes showing the stop button for whichever run command is currently active, instead of always defaulting to the first one.
- bd66e67: Session list overflow buttons now have a background so they no longer blend with long session titles behind them. Chat history Resume/Delete actions also blend cleanly with the row instead of showing a separate panel.
- eb04e56: Session and chat titles now generate reliably instead of falling back to a slug, by giving the underlying `claude -p` call enough time to warm up before timing out.
- 24ced89: The "What's new" dialog now keeps showing the new version's changelog while it downloads, and updates only download after you click "Download update".
- Updated dependencies [713a8cf]
- Updated dependencies [90fec94]
  - @argus/peacock@0.5.0

## 0.8.0

### Minor Changes

- bc5d48f: Stop agents from spawning their own dev servers via Bash and colliding with the runtime you already have open. Agents now have full read/wait access to configured run commands: `list_run_commands` to discover what's in `.argus.json`, `trigger_run` to (re)start it, `wait_for_terminal` to block until a "ready" pattern appears or the process exits (with the captured output and exit code), and `read_terminal` for non-blocking snapshots of recent output. Run-command terminals now keep their captured output around after exit so post-exit reads still work.
- 785ee3f: Make `agent_vitals` actually answer "is this child making forward progress?". The CLI's `status` field flips to `idle` between turns, which made fan-outs look parked even while their children were actively iterating. Vitals now also track lifetime tool-use count, the timestamp and name of the most recent tool call, and the most recent file mtime in the agent's worktree (which catches dev servers / watchers / codegen the agent kicked off in the background).
- 7874c33: Let orchestrator agents health-check a fan-out of children in one round trip. New `agent_vitals` MCP tool accepts a list of agent IDs and returns each one's status, turns completed, and time since the CLI last emitted any event — enough to spot a stuck or slow child without pulling its full transcript or making N separate `agent_status` calls. Unknown agent IDs come back as `status: "not_found"` rather than failing the whole call.
- fd882ff: Give orchestrator agents the tools they need to drive child agents end-to-end. New MCP tools: `stop_agent` and `interrupt_agent` to terminate or redirect a running child, `read_agent_transcript` to inspect a child's full message history (not just its final summary), `session_diff` to review what a child changed before merging (branch / unstaged / staged / head / untracked scopes), `list_session_changes` for a parsed `git status --short` overview, and `read_session_file` to read any file inside a session worktree with path-traversal protection.
- 5f1992e: Give orchestrator agents the tools to drive a child session's lifecycle through merge conflicts and out the other side. New MCP tools: `merge_status` for a comprehensive ahead/behind/conflicts/in-progress report, `attempt_merge` for a resumable merge that pauses the worktree on conflict instead of aborting, `continue_merge` to finish the merge after the orchestrator wrote resolutions, `abort_merge` to roll back, `write_session_file` to land conflict resolutions (with `stage: true` so `continue_merge` picks them up), and `complete_session` for the happy-path "merge into base + delete the worktree" combo.
- c675da6: Let orchestrator agents race multiple children with a single call. New `wait_for_any_agent` MCP tool blocks until the first of several agents finishes its turn or exits and returns which one settled — handy for fan-out workflows where you want to react as soon as any child is ready instead of picking one to block on with `wait_for_agent`.

### Patch Changes

- fe099f3: `spawn_agents_batch` now waits up to 15 minutes for each new session to finish provisioning before launching its agent, instead of timing out after 2. Large repos whose `pnpm install` (or other setup steps) runs longer than two minutes no longer have their child agents silently skipped.
- 04e1079: You can now clear an agent's todo list at any time, even when the tasks aren't all finished — useful when an agent crashes mid-run and leaves a stale list behind.
- 21a0da4: Hover over the Input or Result of any tool call to reveal a copy button. Useful for grabbing the raw input JSON of a Bash, Grep, Agent, or other non-edit tool call to share or replay.
- a454831: Hover any chat message to reveal its timestamp in a left-side gutter. Hover the timestamp itself for the full date and time.
- b827af9: The model picker in the chat input now appears reliably above the chip instead of being clipped by surrounding panels.
- 41cf172: Background agents no longer steal focus. When an agent spawned a child via MCP into the same session you were viewing, the chat panel used to switch to the new child mid-task. Newly added agents now leave the active-agent selection alone — only agents you start yourself open automatically.
- 08e0145: Pull request loading screens now show the spinner animation instead of a static refresh icon.
- ced8f93: Slash command autocomplete in the chat now matches commands that contain your query, so namespaced commands like `/team-tools:review-pr` show up when you type `/review`.

## 0.7.2

### Patch Changes

- 8641df4: Fix "Restart & install" doing nothing after an update finished downloading. On macOS the in-app updater closes the window to terminate, but the close handler was hiding it instead, so the install never ran.

## 0.7.1

### Patch Changes

- ebf055e: Stop mistakenly rewriting `git`, `ls`, and other commands that mention the conductor project path. Conductor device-flag injection now only fires for actual `conductor` CLI invocations, and a stalled simulator pool can no longer wedge agent tool approvals.
- ea9252e: The merge button is now disabled with a clear explanation when the base branch's worktree has uncommitted changes that the merge would overwrite, instead of letting the merge fail mid-flight.
- 447800a: Fix the in-app updater showing "No releases found" by letting electron-builder upload `latest-mac.yml` to the GitHub release. The houwert.dev proxy reads that manifest off the release, so suppressing its upload meant the feed always 404'd.

## 0.7.0

### Minor Changes

- c831895: Link any folder to a chat from the project picker, not just Argus projects or git repos. Use the new "Browse for directory…" option to pick an arbitrary directory the agent should be able to read from and edit.

### Patch Changes

- dc61c32: Auto-fetch PR branches from the remote when starting a session, so checking out a PR authored by someone else just works instead of erroring with "branch does not exist".
- 3827101: Fix the updater hitting GitHub directly (and failing with a 404) instead of going through the houwert.dev release proxy. Also show a short, readable message when the feed is unreachable instead of dumping the raw HTTP response and headers into the "What's new" dialog.
- 7d4b122: Hide the Memory tab in the debug panel while it isn't working reliably.
- 3827101: Remove the "Argus on GitHub" and "Report an Issue…" links since the Argus repository isn't public, point "View all releases" at houwert.dev/argus, and move "Check for Updates…" into the Argus application menu (with a download icon) where it belongs.

## 0.6.0

### Minor Changes

- 494c536: Argus now checks for updates automatically and prompts you to restart when a new version finishes downloading. The Help menu has a manual "Check for Updates…" item, and the home screen shows a banner with a "See changes" button that opens the release notes — extracted from the changelog at build time — inside the running app.

### Patch Changes

- 1d07bdd: Editing a chat message now keeps the bubble's original width and height instead of collapsing it into a small text input.
- d916c2d: Removed the "Link issue" pill from the chat input. It will return in a later update.

## 0.5.0

### Minor Changes

- 8c3cc41: Add a native menu bar with quick actions for new sessions, opening projects, jumping to Agents/Devices/Runtimes/Pull Requests/Review Queue/Notifications/Organizations, toggling panels and tools, and opening the command palette.

### Patch Changes

- 92e53d9: New sessions no longer steal focus when they finish initializing. The agent still starts and runs your prompt in the background — open the session yourself when you want to check on it.
- Updated dependencies [ef5d5f5]
  - @argus/peacock@0.4.1

## 0.4.0

### Minor Changes

- 64ad9f3: Terminal, Debug, and Warnings & errors now live in a new bottom panel beneath the center view, so you can keep them visible alongside Changes or Simulator on the right. Their toolrail icons are grouped at the bottom of the rail, and dragging the top edge of the panel resizes it.
- 64ad9f3: A new Debug panel in the toolrail lets you watch live conductor output for any device. It ships with two tools — streaming app logs and a periodic memory sampler — and is scaffolded so more device diagnostics can slot in as conductor adds them.
- 65e7e98: Added a Cmd+Shift+O palette that searches across open projects, recent projects, and sessions, plus new shortcuts for the bottom panel (Cmd+J), terminal (Cmd+Shift+T), device debugger (Cmd+Shift+D), changes (Cmd+Shift+G), and simulator (Cmd+Shift+M). The right-panel toggle (Cmd+Option+B) now works reliably on macOS keyboards.
- 5e1b74a: Tasks now survive an Argus restart. The neutral host session is recreated against the existing host directory, so you can keep opening agents inside an old task. Host directories are pruned only when a task has been idle for 7 days.
- 70f9047: App settings and project settings now open in a shared iPad-style screen with a list of sections on the left and the active section's controls on the right. Project settings can now also configure protected branches and the preferred pull-request template.
- 18184d4: Tasks now auto-start in plan mode and are required to do all work in fresh worktrees — the host agent may read scope repos to gather context but must spawn child agents (one worktree per repo) for any edits, so changes always land on a task-specific branch you can review and merge.
- 9f5c36e: Each child session inside a task now has its own merge button on the task home screen, so you can land per-repo work back into its source branch without opening every session.

### Patch Changes

- 2420daf: Agents started from the new-session dialog now get a short, generated title on their tab instead of showing the first line of the original prompt.
- 0530ea7: The bottom panel no longer flashes into view on initial agent load when no tool is selected.
- 9432e1b: Fix the "Link other project" popup not appearing when its trigger sits in the chat input toolbar.
- b8e5690: Show dotfiles and dot-directories (like `.github` and `.claude`) when browsing files with `@` in the chat input.
- b1c8850: Permission prompts now show the project name alongside the session name, so it's clearer which agent is asking for approval.
- 7ba94a4: The project folder icon in the sidebar now pulses while any agent inside the project is running, replacing the separate green status dot.
- 08df06e: Fix queued chat messages being sent all at once instead of one per turn.
- 7ced666: Fix new agent tabs vanishing on click in tasks whose on-disk host directory had been removed. The stale session is now pruned with a clear error instead of silently failing to spawn.
- 18184d4: Running tasks in the sidebar now show an empty checkbox — the checkmark only appears once a task is completed, so a checked box reliably means "done".
- 18184d4: The task overview (shared prompt, scope, child agents) now lives as widgets on the session home screen instead of a side panel docked to the chat, freeing up horizontal space while you work.
- Updated dependencies [1bfc1c3]
- Updated dependencies [64ad9f3]
- Updated dependencies [70f9047]
- Updated dependencies [18184d4]
  - @argus/peacock@0.4.0

## 0.3.0

### Minor Changes

- f59bc95: Show a small circular meter next to the model chip in the chat toolbar that fills as the agent's context window fills up. Hover the chip to see the exact percentage and token budget.
- 71d28fa: Right-click an agent tab and choose "Open in New Window" to pop it into its own window with its conversation history already loaded. Press "Back to main window" in the popout to return it to the tab bar. The chat input also now collapses gracefully at narrow widths.
- 1177f75: Press Cmd+F (Ctrl+F on Windows/Linux) inside a chat to search the conversation. Matches are highlighted in-place; Enter jumps to the next match, Shift+Enter to the previous, and Escape closes the search bar.
- dd76128: Slim down onboarding. Picking a project, generating `.argus.json`, creating a first session, and launching a first agent are no longer part of the flow — you'll do all of that directly from the main app when you're ready.
- 60a0354: Link other Argus projects to a chat. A new "Link other project" pill in the chat input opens a multi-select of all known projects; selected directories are attached to every message so the agent can read and edit files across those projects alongside its own worktree.
- 903e8c1: Attach images to the first prompt when creating a new session. Paste screenshots directly into the prompt field, or use the Attach image button — they're sent to the agent with the initial message.
- 953b3b0: When an agent proposes a plan, you can now open it in a full-screen dialog for easier reading of longer plans. Feedback and approve/keep-planning controls remain available inside the dialog.
- 8b4cbdf: Project cards on the home screen now have a "New session" button so you can start a session for that project without opening it first.
- 88c9655: Remove the Activity feed screen and its sidebar entry.
- 70a417e: Add a "Save entire file to disk" hover action to Write, Edit, and MultiEdit tool calls in the chat, so you can apply what an agent proposed without rerunning the tool.
- 447eb89: Sort recent projects on the home screen by the most recent agent activity, so the project you were last working in stays at the top.

### Patch Changes

- 941e05b: Remove the stray accent-colored outline that appeared around the chat input's text area when focused via keyboard.
- 8b4cbdf: Fixed the "New session" button in the sidebar not doing anything when the project had no sessions yet or was collapsed.
- 16a47f2: The Home button in the agent tab bar now has a solid background and casts a shadow to the right when agent tabs scroll behind it, so it stays visually distinct from the tabs.
- e992abd: The "New Agent" button now surfaces the agent tab instantly. The row, active selection, and agents view switch appear as soon as you click, while the Claude subprocess continues spawning in the background.
- 055d38f: Show a warning in the notifications panel when `claude -p` can't generate a session title — typically after a Claude Code login expires. Previously these background failures were silent.
- 059ac68: Starting a new session from a pull request now works when the PR branch only exists on the remote (e.g. a PR authored by someone else). Previously the button appeared to do nothing because the worktree add failed.
- 7f71e0d: The project options menu now opens aligned to the left edge of its button instead of drifting off to the right.
- 055d38f: New sessions appear in the sidebar instantly. The session card is created up front with a stable id and then backfills its branch and title as Claude resolves them, instead of swapping a placeholder for a new row once branch generation finishes.
- a89b8de: Squash merge commits now use a short, single-line message instead of appending the list of original commit subjects.
- 41b250b: The search bar in the chat history list now stays pinned to the top while scrolling, so you can refine your query without scrolling back up.
- 56c59c9: On first launch, ask once to grant Full Disk Access so agents can read files across your projects without macOS re-prompting for every folder they touch.
- d072aba: Fix the persistent "Conductor CLI not found" banner when running dev builds from worktrees by sharing the bundled conductor, simulator bridge, and scrcpy-server from the main checkout.
- Updated dependencies [f59bc95]
- Updated dependencies [903e8c1]
- Updated dependencies [1177f75]
- Updated dependencies [8b4cbdf]
- Updated dependencies [70a417e]
- Updated dependencies [41b250b]
- Updated dependencies [a2a4801]
  - @argus/peacock@0.3.0

## 0.2.0

### Minor Changes

- 6d93f1b: Auto-generated `.argus.json` now recognizes native iOS, native Android, and Flutter projects — including repos where the Xcode/Gradle files live at the root rather than inside an `ios/` or `android/` subfolder.
- 6d664a9: Change a session's source branch from the session home screen. A pencil next to the "from" branch opens a picker of local branches to use as the new merge/diff reference.
- 58581e6: Tighten visual consistency across the home, activity, notifications, and organizations screens — rounded corners, section panels, and callout cards now share one look.
- 4c7f39d: Edit or delete a queued message before the agent picks it up. Hover a queued message to reveal the pencil and trash buttons.
- a9ab6b0: New Inspect panel for live UI inspection of the running app. Capture a snapshot from the device and explore the view hierarchy with a resizable sidebar split into Hierarchy and Accessibility tabs — the Accessibility tab numbers every element in screen-reader order and toggles matching badges on the capture. Selecting a node opens a metadata side panel; a "Focused" pill and amber ring highlight whichever element currently has focus on-device (handy for tvOS remote navigation). Search the hierarchy from the header, and switch simulators without stale snapshots lingering.
- 683b6ca: Show prompts and follow-ups sent over MCP (`spawn_agent`, `spawn_agents_batch`, `send_agent_message`) as system messages in the recipient agent's conversation, so you can see exactly what instructions an orchestrator sent.
- 58a7b1d: Organization cards on the Home screen can now be expanded to show the org's running tasks inline, and task status follows the host agent's live state — a task whose agent has gone idle no longer shows as running.
- 5275f0c: New Pull requests screen lists open GitHub PRs you're authoring, reviewing, or have commented on across your open projects, grouped by status: Awaiting my review, Changes requested, Awaiting another review, Approved, Draft, Other. Every remote counts, so PRs that live on a fork's upstream repo show up alongside PRs on the fork itself. Click a PR to see its description and comments rendered as Markdown, split across Conversation / Commits / Checks / Files changed tabs, with a passing/failing check summary beneath the conversation. A web-icon shortcut opens the PR on GitHub, and one-click action starts a local session on the PR's branch. Results are cached across navigations so returning to the list or a previously-opened PR renders instantly while refreshing in the background.
- ef60455: Rename terminal tabs by double-clicking their title. Tabs pinned to a run command keep their configured name and can't be renamed.
- b218c4b: Drag and drop projects in the sidebar to reorder them. The order is remembered across restarts.
- 80d103a: Session home now folds the merge status, description, and pending changesets into a single card. When a project uses @changesets/cli, the card previews every `.changeset/*.md` introduced on the session branch with its package bumps and release notes before you merge. The card now also swaps the Merge button for "Push & open PR" when the base branch is protected, lets you send a one-click "validate these changesets" prompt to an agent (useful because earlier turns often leave stale release notes behind for work that never landed), caps the changeset list so a long queue scrolls inside the card instead of pushing the merge buttons off screen, respects the project's GitHub pull-request template (auto-detecting single templates and letting repos with multiple templates pin one via `.argus.json`'s `pull_request_template` field), no longer claims a merge succeeded when it actually failed, and catches conflicts with the base branch even when they only exist in the session's staged (but not yet committed) changes.
- 58a7b1d: Organizations in the sidebar are now collapsible and list their running tasks inline, each shown with a dedicated task icon instead of the branch icon.
- d4d20d7: Projects can now opt into a single-runtime mode (set `single_runtime: true` in `.argus.json`). When pressing Run in a session, Argus warns if another session from the same project already has a runtime going, and offers to stop it before starting the new one.

### Patch Changes

- d104277: Include the agent title alongside the session label in finished/failed and permission-requested desktop notifications.
- 348ddaf: Agents now reply to messages from other agents through the MCP instead of printing the answer into their own chat, and no longer reach into another agent's worktree to apply changes on their behalf — the work stays with the agent whose session owns it.
- d732268: Projects in the sidebar with no sessions are now collapsed automatically, without a chevron.
- 1f9648d: File mentions in the chat input now match case-insensitively. Typing `@Button`, `@button`, or `@BUTTON` surfaces the same files, with the closest match ranked first.
- 48dac91: Text selection inside chat messages and plan previews no longer clears itself. You can now drag-select text while an agent is streaming and copy it.
- a9ab6b0: Fix the floating simulator popout showing up as an empty white window.
- 7ff4d19: Restore Claude-generated session titles. The title generation call was timing out because stdin stayed open, triggering a 3-second wait in the Claude CLI; sessions now get proper summarised names again instead of falling back to the humanised branch slug.
- 5275f0c: List-style screens (Organizations, Pull requests, PR detail) now share a single `GridScreen` layout that switches from one column to two on wider displays, so every grid-of-cards view responds to window width consistently.
- 4b84742: Desktop notifications now include the project name alongside the agent and session, and overflow gracefully into the body when the title would get too long.
- 1330d4c: Organizations now render as a two-column grid on wider screens.
- 7fc4c46: The right-hand tool panel now remembers which tool (changes, terminal, simulator) was last open per session. Switching sessions restores that session's tool, or leaves the panel closed if none was opened there.
- f841a13: Clearing a todo list now sticks when you switch sessions and come back. Dismissing hides the list until the agent writes a new one.
- 8a5f16b: Refresh a few icons across the app: the merge/PR icon now matches the familiar pull-request glyph, the reload icon is a cleaner single curved arrow, and the disconnect icon reads more clearly as an unplug.
- a9ab6b0: The enlarged device view no longer shows the live conductor log and command-injection input. The dialog now focuses on device metadata, a live preview, and boot/shutdown controls.
- 0c8f6a5: Fix the ellipsis menu on session cards (and the project overflow menu) not opening on click.
- 5812947: Fix sessions getting permanently stuck on "initializing" when the setup terminal is closed or a setup command crashes before finishing. The session now fails cleanly so it can be retried or removed.
- 55fb4fa: The Home tab in the agent tab bar now stays pinned to the left when scrolling through many agents, so you can always jump back to Home.
- 5c306e2: The "validate changesets" action now also prunes changesets that describe fixes for bugs or UX tweaks introduced earlier on the same branch, keeping release notes focused on the net change against the base branch.
- Updated dependencies [58581e6]
- Updated dependencies [5275f0c]
- Updated dependencies [58a7b1d]
- Updated dependencies [8a5f16b]
- Updated dependencies [80d103a]
  - @argus/peacock@0.2.0
