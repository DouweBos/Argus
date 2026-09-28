
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

