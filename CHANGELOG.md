# argus

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
