
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

