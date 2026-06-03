
### Minor Changes

- d1c573e: Agents can now send native OS push notifications. Use it when an agent is monitoring something (a build, a deploy, a watched process) and you want to be alerted even with the Argus window in the background — clicking the notification jumps straight to the agent's tab.
- 39a1aa8: Remove the global session launcher and its area-screenshot snapping window.

### Patch Changes

- dfcf1b9: Your default permission mode now applies to every new agent at spawn, not just prewarmed ones, so agents no longer fall back to prompting for every action. New agents now default to Auto mode, and the setting moves between Auto, Ask, Plan, Accept edits, and Trusted.
- 81f545f: Fix the first agent in a new session sometimes exiting with an error right after spawning.
- 40b698a: Clearing the agent task list now sticks across the next turn instead of having the previous tasks reappear.
- c288b84: Fix duplicate entries in the agent task list when Claude updates a task it just created — they now show the real task subject instead of appearing as a separate row labeled with the task id.
- ce61875: When the agent updates a task after you've cleared the task list, the original task is now restored with its real subject instead of reappearing as a bare id.

