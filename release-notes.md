
### Minor Changes

- 3b042ae: Sessions stored on an external drive show a small drive icon in the sidebar and in the iOS app.

### Patch Changes

- 2bc16fe: Chat history now stays on your Mac instead of following worktrees to another drive, so it survives changing the worktree location and stays available when that drive is disconnected.
- b23d5dd: The app home screen no longer shows the Remote access, Open repo and New session buttons; they remain on each project's home screen.
- 346ae7d: Moved worktrees show their new location right away instead of after a restart.
- 8330766: Moving worktrees to a new location now shows a progress bar and which worktree is being moved, and no longer freezes Argus while copying between drives.
- Updated dependencies [3b042ae]
  - @argus/peacock@0.23.0

