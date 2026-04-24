# argus

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
