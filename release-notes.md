
### Minor Changes

- 85f3580: Agents now send you a notification on your desktop and phone when something worth knowing happens while you're away, like a long build finishing, even when they carry on without you.
- 85f3580: Automations have an Extra instructions field: rules added on top of the playbook on every run, so you can adjust a built-in automation and still get its playbook updates.
- 85f3580: The phone app has a new setting that automatically expands Read tool calls that returned an image, so screenshots show in the chat without a tap.
- 242636f: The phone app now shows why a session's setup failed and lets you retry it or mark it ready.
- 85f3580: Proposal cards on the desktop and phone now show each step of a start — creating the worktree, running setup, starting the agent — and say why a start failed, with a button to try again.
- 09b829c: Turning on remote access now lets devices on your network connect directly by IP, with no separate Local network switch. Tailscale and Cloudflare tunnels are only needed to connect from outside your network.
- 85f3580: Sessions that are being set up or deleted now show a progress bar with a live status line, on desktop and on the phone, so a slow one is easy to tell from a stuck one.

### Patch Changes

- 85f3580: Slash-command usage counts also stay on your Mac now, and leftover session files are cleaned out of worktree folders.
- 85f3580: Deleting a session no longer fails with "Directory not empty" when something is still writing into its worktree.
- 89f15da: The embedded browser's back/forward state and setup-check progress now update in popout windows and on desktops connected to a remote host.
- aa0f89a: If Argus can't read its list of paired devices, remote access now stays off and reports why instead of starting over and forgetting every paired device.
- 85f3580: Moving worktrees to another drive no longer breaks git in projects that use submodules.
- 85f3580: Starting a proposal whose worktree can't be created now shows the error instead of loading forever, and the proposal can be started again.
- 85f3580: Fix a deleted session's branch staying "already used by session", so a new session can be created on that branch again.
- 85f3580: An agent resumed by an orchestrator now shows the work it does right after resuming instead of an empty chat.
- 85f3580: A session no longer fails to start when a git hook in the project errors after its worktree has already been created.
- Updated dependencies [85f3580]
  - @argus/peacock@0.24.0

