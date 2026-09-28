
### Minor Changes

- a851cc1: Argus has a new peacock-eye app icon. On macOS 26 it follows light and dark mode, and the iPhone app gets dark and tinted versions.
- 31c7fe3: Scratch pads let you start an agent that belongs to no project, in its own folder, from the sidebar, the command palette or the iOS app.

### Patch Changes

- 94ac524: Accounts are no longer marked as signed out or out of usage just because an agent read or wrote text about limits, and session limits are now recognised as a spent quota.
- f5c675d: Agent status now follows Claude Code's own busy state, so an agent that keeps working after a reply, such as while background tasks finish, no longer shows as idle.
- c65f658: Read-only automation runs now file their report and save memories instead of skipping them because plan mode is on.
- 2f916d3: Automation runs no longer show up as projects under Recent projects on the home screen.
- af13429: The iOS app opens agents with long transcripts instead of dropping the connection and showing an empty conversation.
- c7b2529: Tapping a notification while the iOS app is locked no longer crashes it; the app asks you to unlock, then opens the agent.
- Updated dependencies [31c7fe3]
  - @argus/peacock@0.22.0

