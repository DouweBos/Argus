---
"argus": minor
---

Give orchestrator agents the tools they need to drive child agents end-to-end. New MCP tools: `stop_agent` and `interrupt_agent` to terminate or redirect a running child, `read_agent_transcript` to inspect a child's full message history (not just its final summary), `session_diff` to review what a child changed before merging (branch / unstaged / staged / head / untracked scopes), `list_session_changes` for a parsed `git status --short` overview, and `read_session_file` to read any file inside a session worktree with path-traversal protection.
