
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

