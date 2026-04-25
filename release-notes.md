
### Minor Changes

- 64ad9f3: Terminal, Debug, and Warnings & errors now live in a new bottom panel beneath the center view, so you can keep them visible alongside Changes or Simulator on the right. Their toolrail icons are grouped at the bottom of the rail, and dragging the top edge of the panel resizes it.
- 64ad9f3: A new Debug panel in the toolrail lets you watch live conductor output for any device. It ships with two tools — streaming app logs and a periodic memory sampler — and is scaffolded so more device diagnostics can slot in as conductor adds them.
- 65e7e98: Added a Cmd+Shift+O palette that searches across open projects, recent projects, and sessions, plus new shortcuts for the bottom panel (Cmd+J), terminal (Cmd+Shift+T), device debugger (Cmd+Shift+D), changes (Cmd+Shift+G), and simulator (Cmd+Shift+M). The right-panel toggle (Cmd+Option+B) now works reliably on macOS keyboards.
- 5e1b74a: Tasks now survive an Argus restart. The neutral host session is recreated against the existing host directory, so you can keep opening agents inside an old task. Host directories are pruned only when a task has been idle for 7 days.
- 70f9047: App settings and project settings now open in a shared iPad-style screen with a list of sections on the left and the active section's controls on the right. Project settings can now also configure protected branches and the preferred pull-request template.
- 18184d4: Tasks now auto-start in plan mode and are required to do all work in fresh worktrees — the host agent may read scope repos to gather context but must spawn child agents (one worktree per repo) for any edits, so changes always land on a task-specific branch you can review and merge.
- 9f5c36e: Each child session inside a task now has its own merge button on the task home screen, so you can land per-repo work back into its source branch without opening every session.

### Patch Changes

- 2420daf: Agents started from the new-session dialog now get a short, generated title on their tab instead of showing the first line of the original prompt.
- 0530ea7: The bottom panel no longer flashes into view on initial agent load when no tool is selected.
- 9432e1b: Fix the "Link other project" popup not appearing when its trigger sits in the chat input toolbar.
- b8e5690: Show dotfiles and dot-directories (like `.github` and `.claude`) when browsing files with `@` in the chat input.
- b1c8850: Permission prompts now show the project name alongside the session name, so it's clearer which agent is asking for approval.
- 7ba94a4: The project folder icon in the sidebar now pulses while any agent inside the project is running, replacing the separate green status dot.
- 08df06e: Fix queued chat messages being sent all at once instead of one per turn.
- 7ced666: Fix new agent tabs vanishing on click in tasks whose on-disk host directory had been removed. The stale session is now pruned with a clear error instead of silently failing to spawn.
- 18184d4: Running tasks in the sidebar now show an empty checkbox — the checkmark only appears once a task is completed, so a checked box reliably means "done".
- 18184d4: The task overview (shared prompt, scope, child agents) now lives as widgets on the session home screen instead of a side panel docked to the chat, freeing up horizontal space while you work.
- Updated dependencies [1bfc1c3]
- Updated dependencies [64ad9f3]
- Updated dependencies [70f9047]
- Updated dependencies [18184d4]
  - @argus/peacock@0.4.0

