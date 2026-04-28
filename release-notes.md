
### Minor Changes

- 814567f: Generating `.argus.json` from the project home now opens a dialog that explains what the file is and offers two paths: a quick local inference, or a "Generate with Claude" option that runs the Claude CLI to produce a tailored config based on your scripts, native targets, and env files.
- 90fec94: The session home now shows a live initialization status widget while a new worktree is being set up — current step, total remaining, and the file or command in flight — alongside the existing "Setup" terminal output. Adds a reusable `ProgressBar` primitive to Peacock.
- d360d89: Argus now lives in the macOS menu bar. A small icon styled after the app's ring-and-dot mark sits next to your other status items and pops open a dropdown of every running agent grouped by session — pick one to jump straight to that session in the main window. The icon switches between an outlined "all quiet" state and a filled "something's happening" state so you can tell at a glance whether your fan-out is still working, and the dropdown now stays in agreement with the agents screen instead of marking still-busy agents as idle between tool calls.
- 9aa1e90: Added a "Project settings" button to the project home screen that opens the `.argus.json` editor — no need to dig into the sidebar to tweak setup, run commands, or ports.

### Patch Changes

- bd0dee8: Auto-updates now run during onboarding so first-launch users see new versions immediately.
- 54929f8: Generated `.argus.json` no longer ships with a default empty "Shell" terminal tab or a default `ARGUS_PORT` env allocation — those are left to you to add when you actually need them.
- 23769e5: Saving project settings now keeps the trailing newline at the end of `.argus.json`.
- bdb674d: The "Check for Updates…" item in the Argus application menu now uses a refresh icon instead of a download arrow, matching what the action actually does.
- 713a8cf: Modal dialogs now overlay the entire app instead of being clipped to wherever they were triggered from, so the single-runtime confirmation no longer appears stuck inside the top bar.
- 10cbc2d: The onboarding screens now have a proper draggable title bar so the window can be moved while you're setting up Argus.
- d3dc1f3: The Cmd+Shift+O palette now lists projects above sessions, and sessions stay in a stable alphabetical order instead of reshuffling whenever a project's sessions refresh.
- ec20780: User-initiated agent starts now open the new agent automatically again. The toolbar + button, the home-screen Start buttons, recently-closed reopen, and chat-history resume all surface the new agent as active. Background agents spawned via MCP still leave the active tab alone.
- ddaab15: The run button in the center panel titlebar now prioritizes showing the stop button for whichever run command is currently active, instead of always defaulting to the first one.
- bd66e67: Session list overflow buttons now have a background so they no longer blend with long session titles behind them. Chat history Resume/Delete actions also blend cleanly with the row instead of showing a separate panel.
- eb04e56: Session and chat titles now generate reliably instead of falling back to a slug, by giving the underlying `claude -p` call enough time to warm up before timing out.
- 24ced89: The "What's new" dialog now keeps showing the new version's changelog while it downloads, and updates only download after you click "Download update".
- Updated dependencies [713a8cf]
- Updated dependencies [90fec94]
  - @argus/peacock@0.5.0

