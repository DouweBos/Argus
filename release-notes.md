
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

