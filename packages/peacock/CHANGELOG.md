# @argus/peacock

## 0.25.1

### Patch Changes

- 39f8459: Message timestamps in the agent chat no longer cover the start of a message or a tool call's title when you hover it.

## 0.25.0

### Minor Changes

- 40a5499: An agent waiting for a usage limit to reset now shows when it will continue automatically.
- 1da7160: The usage-limit banner has a Cancel button that stops an agent from being continued automatically until one of its turns gets through.

## 0.24.0

### Minor Changes

- 85f3580: Proposal cards on the desktop and phone now show each step of a start — creating the worktree, running setup, starting the agent — and say why a start failed, with a button to try again.

## 0.23.0

### Minor Changes

- 3b042ae: Sessions stored on an external drive show a small drive icon in the sidebar and in the iOS app.

## 0.22.0

### Minor Changes

- a2215da: Scratch pads let you start an agent that belongs to no project, in its own folder, from the sidebar, the command palette or the iOS app.

## 0.21.0

### Minor Changes

- 719f4be: Proposals in the inbox have a View run button that opens the automation run that raised them, so you can read its report or leave feedback without hunting for it — on desktop and on your phone.

## 0.20.0

### Minor Changes

- a1a9a9d: The account switcher now shows which account you are actually signed in as, and
  tells a spent weekly limit apart from an expired sign-in. The limit badge clears
  on its own once a run succeeds.

## 0.19.0

### Minor Changes

- bc535cd: System messages take a `tone` of `error` or `warning`, replacing the `isError` flag.

## 0.18.1

### Patch Changes

- 4d2a9a2: Proposal cards on the home screen now read left-aligned instead of centred.

## 0.18.0

### Minor Changes

- f5369e0: Proposals you already handled yourself can be marked as done instead of dismissed, so agreeing with one no longer reads as rejecting it.

## 0.17.0

### Minor Changes

- 4338b81: A huddle on a wide screen now shows the conversation and the shared device side by side in a resizable split, and the device gets a claim bar that says who's driving with buttons to take control or hand it back.
- 1111d9a: New DeviceStage component: a live device picture presented at the device's real orientation, with pointer input mapped back into the device's own coordinates. The Apple TV Siri Remote moved here too, so every surface driving a TV shares one.
- a4613c1: New ToolInputFields component: a tool call's input as labelled values, with nested objects and arrays flattened into readable paths.

### Patch Changes

- 7e0d47d: Huddle guests can rename themselves from a new settings button, the huddle now fills a landscape tablet instead of a narrow column, and chat avatars stay round next to multi-line messages.

## 0.16.0

### Minor Changes

- 6518f06: New `DeviceDriverBadge` showing who is driving a shared device and who is being refused it, and `GuestList` rows can now say someone is waiting for the device.
- 6518f06: New `HuddleChat` for a room's side conversation, a `ChatIcon`, and a `useUnreadCount` hook for "3 since you last looked" badges.
- 6518f06: New `InviteMessage` for showing a ready-to-paste invitation with copy actions for the message and the bare link.
- 6518f06: New `TypingIndicator` for showing who is composing a message, with the dots bouncing where its ellipsis would be. `GuestList` rows can now say someone is typing, and `ThinkingDots` takes a `slow` variant for dots that sit in running text.
- 6518f06: The remote web client now uses the full screen on an iPad or a desktop browser: your projects and sessions stay in a resizable sidebar beside whatever agent, device or diff you have open. Phones keep the single-column layout.

  Touch handling got a pass too — pinch-zoom works again, the composer stays above the keyboard, the layout clears the notch in landscape, and hover styles no longer stick after a tap. With a hardware keyboard, Cmd+[ and Cmd+] move back and forward, Cmd+\ toggles the sidebar, Cmd+K jumps to the composer and Cmd+/ lists the lot.

  The remote client's model, mode and project pickers, its slash-command list and its @-mention picker now look and behave exactly like the desktop's, and its session cards pick up the desktop styling.

## 0.15.0

### Minor Changes

- 844011e: Automations show their trail in the window title bar — Argus · Automations · the automation · the run — instead of a back link inside the page, and every step is clickable. The session an automation run spawns its agent into now sits under that run too, rather than looking like one of your own worktrees.

## 0.14.0

### Minor Changes

- b1600ee: New `SetupBlocker` component for explaining a blocked action: what went wrong, why, the steps to fix it, and a copyable command.

## 0.13.0

### Minor Changes

- 1de4556: GuestList can remove a guest who has already been decided on.
- 1de4556: MessageBubble can attribute a user message to a named sender.
- 1de4556: New DirectoryBrowser component for picking a folder from a caller-supplied listing, plus Laptop and Host icons.
- 1de4556: QueuedMessage can attribute a queued message to a named sender.
- 1de4556: New QueuedMessageEditor for editing a queued message in place.
- 226eb2b: Remove organizations and cross-repo tasks. Argus is now built around projects and sessions only — the Organizations screen, sidebar section, and task orchestration are gone, along with the agent prompts and MCP tools that went with them.
- 1de4556: Automation reports can now come back as a dashboard: headings, stat strips, tables, lists, bar and line charts, plus live cards for the sessions and proposals they mention. Reports written as plain markdown keep rendering exactly as before.
- 1de4556: Run history rows can show which automation a run belongs to.
- 1de4556: First launch is now just a welcome screen and a telemetry choice. Missing setup — the Claude CLI, a signed-in Claude account, git, your git identity, notification permission — shows up as a card on the home screen with a one-click fix instead of a wizard step, and your git identity is now editable in Settings → Git.

### Patch Changes

- 1de4556: Fix the Claude account switcher showing "Sign in again" on every account, and stop agents from running against a removed account — which made them fail with authentication errors.

## 0.12.3

### Patch Changes

- 5d18ded: Image attachments in chat messages now have a subtle outline so they stand out from the background.
- 43edb2d: The loading spinner on a running sub-agent tool call now spins in place instead of swinging around an off-centre point.

## 0.12.2

### Patch Changes

- e0c539b: Fix the sub-agent loading indicator wobbling instead of spinning.

## 0.12.1

### Patch Changes

- e1be735: Give each Claude account its own CLI identity so agents stop failing with "OAuth session expired and could not be refreshed" after switching accounts. Accounts whose credentials stop working now show as Signed out in Settings with a Sign in again button.

## 0.12.0

### Minor Changes

- 708322f: Device UI inspection is now Apple-only and reads the running app in-process for
  much richer detail — real class names, resolved colors and fonts, text, and the
  full view/layer tree — instead of the accessibility-only snapshot. The Inspect
  mode only appears for iOS/iPadOS/tvOS runtimes. If the app isn't set up for
  inspection, Inspect now offers one click to restart the running app with it
  enabled, or — on the home screen — a picker to launch any installed app with
  inspection. Selecting an element lets you live-edit its text, colors, alpha,
  visibility, corner radius, and border right on the device. Adds a ColorSwatch
  component to the design system.

### Patch Changes

- f1126d7: Anchored dropdowns (run commands, runtime picker, runtime links) no longer close when unrelated parts of the app scroll, such as the agent chat auto-scrolling on a new message.

## 0.11.0

### Minor Changes

- fcee84e: Sub-agent tool calls now show a spinner next to their title while the sub-agent is still running, so you no longer have to watch the "+N more" count to tell if it's finished.

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
