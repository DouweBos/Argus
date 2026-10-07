
### Minor Changes

- 7b88684: Projects can now continue agents automatically once a Claude usage limit resets. Turn it on under Project Settings → Agent.
- ed7b0cd: The phone lists every agent on your computer in one place, across projects, with the ones working or waiting on you first.
- 7b31d1f: On the phone you can now draft an automation from a description, see an automation's track record, delete a run, and set the computer's autonomy cap.
- b1475c5: The phone's automation editor shows a schedule's next runs and won't save one that is invalid or never fires.
- 7b31d1f: The phone can set a default permission mode for the agents you start from it, and lists the warnings and errors it showed you under Settings.
- 7b31d1f: The phone has a screen for each inbox proposal, where you can start it with a note, ask the automation for a revision, or read what became of it.
- 61b0ca6: Messages you send from the phone appear right away with a sending indicator, including ones queued while the agent is busy.
- b592392: The phone can now apply, pop and drop a session's stashes, list its tags, and amend the last commit.
- c6aa5f8: Terminal output on the phone now streams live instead of refreshing every two seconds.
- acc8f70: Follow a session's terminals and dev servers from your phone: their output updates as it runs.
- 40a5499: An agent waiting for a usage limit to reset now shows when it will continue automatically.
- 1da7160: The usage-limit banner has a Cancel button that stops an agent from being continued automatically until one of its turns gets through.
- 5ba6764: The Mac app blames a file at any branch, tag or commit, not only ones on the checked-out branch's line.
- 148a07d: Starting with this release, only one Argus runs on your projects at a time — this app, the Mac app beta or the standalone host. Opening a second one tells you which app has them open and offers to quit it and carry on, which is how you hand over between this app and the Mac app.
- 9cace55: Your preferences — theme, display size, agent defaults, editors, git views and telemetry choice — and picks such as recent projects, each session's device and favourite branches are now kept with your Argus home, so Argus for Mac opens with the same ones. The Electron app copies the ones it had the first time it starts.
- 78b4dd2: Paired devices and MCP sign-ins are now stored in a format Argus for Mac can read too. The Electron app moves existing ones over when it starts, and keeps using them as they are until the move succeeds.

### Patch Changes

- 2d04f6d: Agents started from an automation proposal or run now show the prompt they were given at the top of their chat, on desktop and on the phone.
- 63165eb: An automation run's transcript can be opened again after Argus restarts, and from clients connected to the host.
- 854e91c: Browser DevTools and agent browsers recover after the browser process dies, instead of pointing at a dead connection until Argus restarts.
- 1b1b8a3: Typing into the embedded browser no longer enters each key twice.
- 4d39b02: Comparing two branches warns again when merging them would conflict.
- 5d1141f: The Dock icon now follows your dark, light or tinted appearance instead of always showing the light version.
- 99aa799: Home, Back and typing now reach Android emulators that were created without a hardware keyboard, such as many API 36 AVDs.
- 218f369: Two tool calls in a row now fold into one row, and with "Expand image reads" on, image reads stay visible outside the folded group.
- 8fd11a5: A git command that fails on a branch or file with "conflict" in its name no longer reports a paused merge.
- 53a6dc3: A phone paired with a host that has no Argus window open now shows agent transcripts, delivers its messages (queued ones too), and finds finished runs in the chat history.
- 8352d2f: The standalone host no longer hangs on the keychain when it runs with a different home folder.
- 59a22dc: A host started from outside its install folder now gives agents their Argus instructions again.
- 9a34a2d: A host whose state lives in a temporary folder keeps reading its paired devices after updating, and says why remote access failed instead of printing an address nobody can connect to.
- 8bb89f6: The phone's Agents list now updates on its own as agents start, finish or wait for you.
- c5dcd9c: Creating an automation from the phone works again, and setting its autonomy back to "inherit" now saves.
- 0d73b19: The phone no longer shows stray timestamps between messages in an agent's transcript, and runs of tool calls fold together again.
- d2228c8: The phone no longer forgets a computer's Tailscale or tunnel address after connecting while that address was off, so it can still reach the computer away from home.
- 9c2f4c4: Tool calls waiting for your approval on the phone, including ones a sub-agent makes, are never folded into a collapsed group and can be answered in place.
- 4d166b0: Inbox proposal buttons on the phone show their full labels instead of cutting them off.
- 3d4c93b: Quick runs started from the phone no longer fail to start.
- 87b371f: Opening an agent that has already stopped on the phone, such as a finished automation run's, now says so instead of offering a message box that can only fail.
- cc2e306: The phone no longer shows a usage-limit "continues at" banner for an agent that has already stopped.
- 09456a6: The Mac app's commit list keeps branch badges and long subjects inside the Subject column instead of drawing over the author.
- a48cd32: The Mac app's branch comparison no longer shows a cancellation error when the repository refreshes while it loads.
- 509d265: Display size in the Mac app now scales all text, including the sidebars, transcripts, diffs, blame and the commit list.
- f8819d9: The Mac app's branch comparison for a session on another computer now shows the merge base and whether merging would conflict.
- f2ecd20: The Mac app marks an agent spawned by another agent as its sub-agent in the session's tab strip.
- e4da3a0: The Mac app's git views for a worktree session no longer refresh for activity in the repository's other worktrees.
- e27a6c3: Testing a command-line MCP server now lists the tools it offers, as it already did for HTTP servers.
- 78b07ad: A project's home session is back as soon as the host restarts, so clients that connect afterwards see it without reopening the project.
- e484496: Adding a project by a path spelled differently (with `..` or a trailing slash) no longer lists it twice.
- a1ca03d: Notifications an agent sends you now appear as their own highlighted card in the chat and are never folded away with other tool calls.
- 0697be4: Argus only cleans up leftover terminal and agent processes from its own previous run, so a second Argus on the same Mac no longer touches the first one's.
- dd61181: Generating a project's `.argus.json` with Claude no longer waits on input it never gets, and shows the real reason when it fails.
- b16919f: On the phone, a permission answer the computer refuses now brings the prompt back with the reason, instead of silently disappearing.
- 2967113: The Mac app's git views for a session on another computer now update as soon as files or commits change there, instead of waiting for your next action.
- c2b6f9b: Git commands a connected Mac runs on this computer stop when it disconnects, and the scratch files they leave in the repository are cleaned up.
- 1a84b1c: Sessions whose worktrees live behind a symlinked folder (such as `/tmp` on macOS) now come back after a restart instead of disappearing.
- 50aaa0e: A session's setup terminal keeps its Setup name after the window reloads, instead of coming back as a plain shell.
- 8253333: A project's main session keeps the same identity and name across restarts, so links to it and connected devices no longer lose track of it.
- e3ccde6: Sessions on an external drive no longer disappear when the drive is unplugged and macOS leaves an empty folder in its place, and reconnecting the drive never deletes a worktree Argus lost track of.
- db92294: The phone no longer offers to answer a permission prompt for an agent that has stopped, and says plainly when an answer arrives too late.
- 2cf204c: The Mac app and the phone no longer lose requests sent in quick succession, which left git views on another computer waiting two minutes before they updated again.
- Updated dependencies [40a5499]
- Updated dependencies [1da7160]
  - @argus/peacock@0.25.0

