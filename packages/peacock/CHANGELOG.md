# @argus/peacock

## 0.4.0

### Minor Changes

- 64ad9f3: A new Debug panel in the toolrail lets you watch live conductor output for any device. It ships with two tools — streaming app logs and a periodic memory sampler — and is scaffolded so more device diagnostics can slot in as conductor adds them.
- 70f9047: App settings and project settings now open in a shared iPad-style screen with a list of sections on the left and the active section's controls on the right. Project settings can now also configure protected branches and the preferred pull-request template.

### Patch Changes

- 1bfc1c3: Chat input now expands to fill its wrapper when it has no action pills, so long prompts no longer get cut off behind the send button.
- 18184d4: Running tasks in the sidebar now show an empty checkbox — the checkmark only appears once a task is completed, so a checked box reliably means "done".

## 0.3.0

### Minor Changes

- f59bc95: Show a small circular meter next to the model chip in the chat toolbar that fills as the agent's context window fills up. Hover the chip to see the exact percentage and token budget.
- 903e8c1: Attach images to the first prompt when creating a new session. Paste screenshots directly into the prompt field, or use the Attach image button — they're sent to the agent with the initial message.
- 8b4cbdf: Project cards on the home screen now have a "New session" button so you can start a session for that project without opening it first.
- 41b250b: Add `--surface-3-solid` and `--surface-4-solid` tokens — opaque equivalents of the translucent `--surface-*` overlays, for cases where an absolutely-positioned overlay needs to fully cover what's underneath.

### Patch Changes

- 1177f75: `ChevronUpIcon` now matches `ChevronDownIcon` in optical weight and default size, so up/down chevron pairs render consistently.
- 70a417e: Add a "Save entire file to disk" hover action to Write, Edit, and MultiEdit tool calls in the chat, so you can apply what an agent proposed without rerunning the tool.
- a2a4801: Truncate long agent names in the active agents list so a single row no longer expands to fill the panel.

## 0.2.0

### Minor Changes

- 58581e6: Tighten visual consistency across the home, activity, notifications, and organizations screens — rounded corners, section panels, and callout cards now share one look.
- 5275f0c: List-style screens (Organizations, Pull requests, PR detail) now share a single `GridScreen` layout that switches from one column to two on wider displays, so every grid-of-cards view responds to window width consistently.
- 58a7b1d: Organization cards on the Home screen can now be expanded to show the org's running tasks inline, and task status follows the host agent's live state — a task whose agent has gone idle no longer shows as running.
- 8a5f16b: Refresh a few icons across the app: the merge/PR icon now matches the familiar pull-request glyph, the reload icon is a cleaner single curved arrow, and the disconnect icon reads more clearly as an unplug.
- 80d103a: Session home now folds the merge status, description, and pending changesets into a single card. When a project uses @changesets/cli, the card previews every `.changeset/*.md` introduced on the session branch with its package bumps and release notes before you merge. The card now also swaps the Merge button for "Push & open PR" when the base branch is protected, lets you send a one-click "validate these changesets" prompt to an agent (useful because earlier turns often leave stale release notes behind for work that never landed), caps the changeset list so a long queue scrolls inside the card instead of pushing the merge buttons off screen, respects the project's GitHub pull-request template (auto-detecting single templates and letting repos with multiple templates pin one via `.argus.json`'s `pull_request_template` field), no longer claims a merge succeeded when it actually failed, and catches conflicts with the base branch even when they only exist in the session's staged (but not yet committed) changes.
