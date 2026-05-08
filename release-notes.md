
### Minor Changes

- 886750b: Open Pull Request dialog now pre-fills the description from your project's PR template, and adds an Auto-fill button that drafts the body from your session's commits and diff.
- 5002a14: Switch the agent's reasoning effort directly from the chat input — a new pill next to the permission mode lets you pick between low, medium, high, extra high, and max for models that support it.

### Patch Changes

- 4cff062: Orchestrating agents now know that newly-created sessions take time to provision and won't immediately show their spawned agents — preventing duplicate worktrees from premature respawns after a flaky MCP transport.
- 672263d: Right-align the boot icon next to the other toolbar buttons in the device runtime view.
- 0003310: Chat messages now mark as read whenever the chat is open, instead of waiting for them to scroll into view. Opening a chat clears its unread state, and any new turns that arrive while you're already in the chat clear immediately too.
- 4d10690: Escape spaces in file and folder paths dropped onto the chat input so the resulting `@`-mention links stay intact.
- 2ce69f8: Fix the Force Push checkbox in the Push dialog unchecking itself, and clarify its wording so it matches what force-pushing actually does.
- b8df050: Fix opening pull requests failing with an `unknown flag: --json` error from the GitHub CLI.
- 02ea2c0: Remove the "Mark as unread" action from individual chat messages.
- ceedafc: Reuse existing terminal tabs when a run command's required dependency restarts, instead of opening a duplicate tab next to the stale one.
- Updated dependencies [2ce69f8]
  - @argus/peacock@0.9.1

