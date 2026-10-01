
### Minor Changes

- 094a8e8: Agents now send you a notification on your desktop and phone when something worth knowing happens while you're away, like a long build finishing, even when they carry on without you.
- 43db230: Automations have an Extra instructions field: rules added on top of the playbook on every run, so you can adjust a built-in automation and still get its playbook updates.
- 3b79d6f: The phone app has a new setting that automatically expands Read tool calls that returned an image, so screenshots show in the chat without a tap.
- 6884e62: Proposal cards on the desktop and phone now show each step of a start — creating the worktree, running setup, starting the agent — and say why a start failed, with a button to try again.
- 404de4e: Sessions that are being set up or deleted now show a progress bar with a live status line, on desktop and on the phone, so a slow one is easy to tell from a stuck one.

### Patch Changes

- d8d3828: Slash-command usage counts also stay on your Mac now, and leftover session files are cleaned out of worktree folders.
- 469db25: Deleting a session no longer fails with "Directory not empty" when something is still writing into its worktree.
- 797b707: Moving worktrees to another drive no longer breaks git in projects that use submodules.
- 215a841: Starting a proposal whose worktree can't be created now shows the error instead of loading forever, and the proposal can be started again.
- 8d28f8b: Fix a deleted session's branch staying "already used by session", so a new session can be created on that branch again.
- 34ab9a7: An agent resumed by an orchestrator now shows the work it does right after resuming instead of an empty chat.
- 32b93fd: A session no longer fails to start when a git hook in the project errors after its worktree has already been created.
- Updated dependencies [6884e62]
  - @argus/peacock@0.24.0

