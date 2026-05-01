
### Minor Changes

- 4a29e75: Configure a `default_base_branch` in `.argus.json` (or via Project settings → Branch protection) to preselect that branch when creating a new session. Without it, Argus now also probes for `staging`, `develop`, and `dev` before falling back to `main`/`master`.
- 7021024: The Delete Session dialog now warns you specifically when a session has unmerged commits, staged changes, modified files, or untracked files that would be lost — instead of showing the same generic warning for clean and dirty sessions alike.
- 6483947: Drag and drop image files into the chat input to attach them, alongside the existing paste-from-clipboard flow.
- 5d835fa: Adds a full-featured git workspace: a sidebar for branches, tags, remotes, and stashes; a commit history graph with author avatars, refs, and inline commit details; a working copy view with multi-select staging and quick actions; drag-and-drop to reorder, squash, revert, and apply commits; an integrated commit composer with autocomplete and amend support; tools for blame, compare, image diffs, interactive rebase, auto-fetch, and pull request authoring; and a keyboard shortcut cheatsheet.
- a79d66d: Merging a session now includes all work in its worktree — committed, staged, modified, or untracked — so nothing gets left behind on the branch when you merge.
- ccfdb62: Track navigation as `$pageview` events when telemetry is enabled, so PostHog Web Analytics and DAU insights work. URLs are sanitised first — every dynamic segment (session, organisation, PR identifiers) is replaced with a placeholder before the event leaves your machine.
- d21b754: Each session now remembers which center panel (agents, editor, git, home) you last viewed it on. Switching to another session — including switching projects — restores that session's panel instead of reusing the panel from the previous session.
- 4cc2959: Added a Link button to the runtime toolbar for connected simulators and emulators. It opens a dropdown of project-configured deep links (set under `simulator_deeplinks` in `.argus.json`) and fires the chosen one into the device. Deep links can be grouped into folders, and folders may nest. The Project Settings dialog now ships a polished tree editor for the list, plus editable Deep links and Related projects sections, and the rest of the dialog has been brought up to the same polish: list items render as cards with hover-revealed delete buttons, empty states use a real illustration, Platforms toggles are interactive chips, Run command "Requires running" entries are togglable chips, Branch protection's Advanced block uses a proper collapsible, and the JSON preview shows in a code block with a built-in copy button.

### Patch Changes

- 4cc2959: Saving Project Settings now refreshes the deep links menu, run commands, and protected-branch flags immediately. Previously you had to navigate away from the project and back for the new `.argus.json` values to take effect.
- 6f0a373: Pull requests where you're only a team reviewer no longer show both "Reviewer" and "Team review" pills — just "Team review".
- a737e46: Reclaim the traffic-light gap in the title bar when the window enters macOS fullscreen.
- Updated dependencies [5d835fa]
- Updated dependencies [4cc2959]
  - @argus/peacock@0.7.0

