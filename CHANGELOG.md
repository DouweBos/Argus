# argus

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
- ced8f93: Slash command autocomplete in the chat now matches commands that contain your query, so namespaced commands like `/plex-tools:review-pr` show up when you type `/review`.

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
