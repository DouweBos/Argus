---
"argus": patch
---

MCP session and orchestration tools (`trigger_run`, `spawn_agent`, `merge_session`, `session_diff`, and the rest) now require a `project_path` argument. This stops a branch or display name shared across projects from silently resolving to the wrong project's session.
