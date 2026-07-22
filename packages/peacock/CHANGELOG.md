# @argus/peacock

## 0.10.0

### Minor Changes

- eaeea3f: Session cards now share one design-system component across the desktop sidebar and the remote web client, so both render the same icon, badges, and diff stats. The remote web session list picks up the desktop's colors and styling instead of its previous grey, hand-rolled look.
- 7d3f24d: Connected capture cards and cameras now show up as devices you can watch live. Pick one from the runtime target picker's new Video Inputs section, or open it from the Devices list, to see its picture. It's view-only.
- eaeea3f: The remote web client now mirrors the desktop chat faithfully: markdown, per-tool rich rendering, edit/write diffs, embedded images the agent read, nested sub-agent activity, and task/todo lists — all read-only. The chat presentation layer is now shared design-system components, so the desktop and web views stay in sync.
- eaeea3f: Permission prompts in the remote web client now render inline in the transcript, exactly like the desktop — including the interactive AskUserQuestion form and plan approval — instead of a separate raw prompt card at the top. You can pick answers, send plan feedback, or allow/deny right where the tool call appears.
  </content>
- eaeea3f: You can now queue messages to a busy agent from the remote-control web client — type while it's working and the message is held, then sent automatically once the agent goes idle. Queued messages show in the transcript and can be removed before they send.

## 0.9.1

### Patch Changes

- 2ce69f8: Fix the Force Push checkbox in the Push dialog unchecking itself, and clarify its wording so it matches what force-pushing actually does.

## 0.9.0

### Minor Changes

- a5d5448: Add `HoverTimestamp` — a wrapper that overlays a hover-revealed time gutter on its children, supporting both single timestamps and time ranges.

## 0.8.0

### Minor Changes

- e0de455: Chat now shows a single "Unread" divider above the first unread message instead of marking each message individually. The divider clears as soon as you scroll past it, and the hover "Mark as unread" action moves it back to that point. Agent tabs, session cards, and project cards still show an accent dot when any of their agents have unread messages.

### Patch Changes

- 304c032: Fix AskUserQuestion answers that contained commas or free-form text being shown as "No answer" after submission. Selected option labels are now matched by substring scan rather than comma splitting, and any free-form note is rendered alongside the picks.

## 0.7.1

### Patch Changes

- 9e403af: Polish git status badges: ahead-of-base badge in the sidebar matches the height of branch badges, and ref badges no longer show a stray accent glow on the active branch.
- ed2f3c3: Project folder badges on the home screen now keep their accent color when agents are running, instead of turning green.

## 0.7.0

### Minor Changes

- 5d835fa: Adds a full-featured git workspace: a sidebar for branches, tags, remotes, and stashes; a commit history graph with author avatars, refs, and inline commit details; a working copy view with multi-select staging and quick actions; drag-and-drop to reorder, squash, revert, and apply commits; an integrated commit composer with autocomplete and amend support; tools for blame, compare, image diffs, interactive rebase, auto-fetch, and pull request authoring; and a keyboard shortcut cheatsheet.
- 4cc2959: Added a Link button to the runtime toolbar for connected simulators and emulators. It opens a dropdown of project-configured deep links (set under `simulator_deeplinks` in `.argus.json`) and fires the chosen one into the device. Deep links can be grouped into folders, and folders may nest. The Project Settings dialog now ships a polished tree editor for the list, plus editable Deep links and Related projects sections, and the rest of the dialog has been brought up to the same polish: list items render as cards with hover-revealed delete buttons, empty states use a real illustration, Platforms toggles are interactive chips, Run command "Requires running" entries are togglable chips, Branch protection's Advanced block uses a proper collapsible, and the JSON preview shows in a code block with a built-in copy button.

## 0.6.0

### Minor Changes

- 988c5db: Add anonymous usage and crash reporting via PostHog. Argus only sees which features are used and what errors occur — never your prompts, file contents, project names, or any identifying information. New installs now choose during onboarding whether to share data; the default is off until you opt in. A "?" button at the bottom of the tool rail (always visible) opens an anonymous feedback dialog. Flip the choice any time under Settings → Privacy. Disabled in development builds.

### Patch Changes

- 87b2808: Soften the dark theme: backgrounds are lifted from near-black to a slightly lighter slate, and primary text is dimmed from pure white to an easier-on-the-eyes off-white.
- 98e243c: The branch icon in session cards stays the same size when the session name is long.

## 0.5.0

### Minor Changes

- 90fec94: The session home now shows a live initialization status widget while a new worktree is being set up — current step, total remaining, and the file or command in flight — alongside the existing "Setup" terminal output. Adds a reusable `ProgressBar` primitive to Peacock.

### Patch Changes

- 713a8cf: Modal dialogs now overlay the entire app instead of being clipped to wherever they were triggered from, so the single-runtime confirmation no longer appears stuck inside the top bar.

## 0.4.1

### Patch Changes

- ef5d5f5: Improve contrast of chat message hover action buttons in light theme so the icons are no longer grey-on-grey.

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
