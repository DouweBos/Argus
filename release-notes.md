
### Minor Changes

- 642bdaa: Project roots sitting on a protected branch (e.g. `main`) now fetch from origin in the background and surface their ahead/behind status in the sidebar — so new sessions don't get created on top of a stale trunk.
- a428da7: The new-session dialog now offers `origin/*` branches as the source for a fork. When the project root has a protected branch like `main` checked out, the dialog defaults to `origin/main` instead of the local copy so the new session always starts from the authoritative remote tip.
- 670da55: Retry failed session setup directly from the home screen — a new Retry button on the "Setup failed" banner re-runs the configured setup commands without recreating the session.
- 3ef438a: Squash, delete, reset, revert, cherry-pick, and other history-rewriting commit actions are now available from the right-click menu in a session's branch view, matching the project-level git view.
- e80de90: Commits in the git timeline now show ahead/behind arrows again (decorations were missing from `git log`, so the indicator silently disappeared), and the session-scope sidebar surfaces an ahead/behind count next to the Branch row. The unused History entry has been removed from the session sidebar.

### Patch Changes

- 2e7eede: Sessions whose base branch is protected now show their branch diff against `origin/<base>` instead of the local copy, so the file list reflects what a pull request would actually contain even when the local base branch is out of date.

