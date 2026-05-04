
### Minor Changes

- ba0eee0: The Agents view now shows a focused launcher when no agent is running — type a prompt and hit ⌘↵ to spawn an agent in one step, instead of repeating the Home screen.
- 8b07008: When the commit history contains `fixup!` or `squash!` commits with matching targets on the current branch, a banner now offers a one-click autosquash to fold them in.
- 88c23da: The project branch switcher now groups branches by priority — current, protected (main/master/staging/develop and project-configured), branches matching your personal prefix, then everything else — and hides branches already checked out in another session.
- 7d997fb: Settings now has an LLM section where you can pick the default runner and model used for new sessions. Today Claude Code is the only registered runner; the model field is optional and falls back to the runner's default.
- 52a2383: Removed the "Defaults" onboarding step. Git identity is collected inline in Preflight when missing, and the default Claude model is now editable under Settings → Agents.
- fa20b22: Home is now a session-level tab alongside Agents, Editor, and Git instead of a tab inside the agents bar, and each tab now shows a leading icon.
- 0c5acf9: Pick from all four runner permission modes (Auto, Plan, Accept edits, Trusted) when starting an agent or while a conversation is running. The chat input replaces the binary Plan toggle with a chip that opens a mode picker, and Shift+Tab cycles through modes without leaving the keyboard.
- 4aa2277: Preflight now installs missing tooling on your behalf. The Claude CLI, Playwright browsers, the iOS simulator runtime, and the native sim bridge all gain an Install button, and missing git identity is collected via an inline form instead of a copy-paste command.
- 7d997fb: Project settings now include an LLM section where you can pin the default runner and model for everyone working in the repo via `.argus.json`.
- dc7554f: `setup.copy` and `setup.symlink` entries can now be objects of the form `{ "path": ".claude", "exclude": ["projects/**/worktrees/**"] }` to prune subdirectories from the copy/symlink expansion. Bare path strings still work — useful for keeping `.claude` cached without dragging Claude Code's per-session worktrees from the source branch into every new session.
- 1f1fdaa: Squashing selected commits no longer requires the selection to be contiguous. Non-selected commits in between replay on top of the squash; if that conflicts, the rebase is aborted and the error surfaced. Cmd-clicking an already selected commit in the git history now deselects it.
- e0de455: Chat now shows a single "Unread" divider above the first unread message instead of marking each message individually. The divider clears as soon as you scroll past it, and the hover "Mark as unread" action moves it back to that point. Agent tabs, session cards, and project cards still show an accent dot when any of their agents have unread messages.

### Patch Changes

- c89c11c: Amend now works on pushed commits without a confirmation prompt or backend block. Force-push policy is left to your remote's branch protections.
- 304c032: Fix AskUserQuestion answers that contained commas or free-form text being shown as "No answer" after submission. Selected option labels are now matched by substring scan rather than comma splitting, and any free-form note is rendered alongside the picks.
- e10ce39: AskUserQuestion now lets you switch from a selected option back to the free-text answer. The custom answer field has its own radio button, so picking it deselects other choices (and vice versa).
- 3a82e5a: Preserve in-progress answers and plan feedback when switching agents or views. The free-text inputs in AskUserQuestion and ExitPlanMode prompts no longer reset to empty when you navigate away and come back.
- 09f373e: Discarding a staged hunk now also removes it from the index, so the merge-conflict button no longer lingers after you discard your conflicting changes.
- 5820efe: Fix the running indicator disappearing after editing the last message in a chat. The agent restart triggered an exit event that flipped the indicator to stopped before the new run could light it up again.
- e1e00b7: Forking a session no longer shows a duplicate row in the sidebar, gets stuck in "initializing", or starts the new agent with an empty conversation. The fork's reset, working-tree replay, and conversation truncation now run after the new worktree exists, so the resumed agent picks up where you left off.
- e10ae8a: The git panel now lets you create the first branch in a fresh repo. The branches sidebar shows a "Create branch" button when the list is empty, the toolbar's Branch action opens the new-branch dialog in project scope, and creating a branch on an unborn HEAD no longer fails.
- c3d6663: Fix double-tap right Option launcher trigger in signed builds. The native helper now registers properly with macOS Accessibility so the permission prompt actually appears, and granting it makes the global hotkey work.
- df21a83: Remove the grey background behind the markdown in the proposed plan dialog so it sits flush on the dialog surface.
- 7d997fb: Project Settings now picks the LLM runner from the registered runners (matching app-level Settings) instead of a free-form text field.
- f28496d: Stale worktrees deleted outside Argus (e.g. by Claude Code's Agent tool) are now pruned automatically, so the git view no longer fails to load with a "fatal: not a git repository" error after a sibling worktree directory was removed by hand.
- 44a891e: The session options (…) button now stays pinned to the right of the session card when the title is truncated.
- 5047f18: Drop the file-count badge from session and project cards in the sidebar — only line additions and deletions are shown now.
- Updated dependencies [304c032]
- Updated dependencies [e0de455]
  - @argus/peacock@0.8.0

