
### Minor Changes

- b3e20f7: Forking a chat now asks whether to spin up a new session (fresh worktree) or a new agent in the current session that shares the workspace.

### Patch Changes

- 7fdc8f5: Fix a bug where editing the most recent message after cancelling the agent could make Claude lose the previous turn, picking up as if it had ended one turn earlier.
- 0d31898: Fix Auto permission mode prompting on simple edits and bash calls. Prewarmed Claude subprocesses now start in Auto mode so the CLI flag is set at spawn — runtime switches to Auto from the default mode aren't honoured by Claude Code.
- d7e3676: The branch switcher dropdown now flips above the trigger when there isn't enough room below it, so it no longer gets clipped by the window edge on the bottom-most project.
- 24c4426: MCP session and orchestration tools (`trigger_run`, `spawn_agent`, `merge_session`, `session_diff`, and the rest) now require a `project_path` argument. This stops a branch or display name shared across projects from silently resolving to the wrong project's session.
- 8c15541: Fix MCP `list_sessions` returning the wrong project's sessions when an agent in a multi-project setup omitted `project_path`. Calls without `project_path` now error out when more than one project is registered instead of silently defaulting to the first.
- 0d31898: Fix agents occasionally appearing in an immediate error state when starting. A prewarmed subprocess could be discarded mid-claim if the user navigated away, killing the just-claimed agent.
- 0d31898: Fix worktree setup commands not picking up mise / asdf / rbenv shims. Setup now runs in the user's shell so rc files load — previously it used a bare `/bin/sh`, which fell back to the system Ruby/Node.

