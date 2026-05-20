---
"argus": patch
---

Fix MCP session tools (`trigger_run`, `list_run_commands`, and others) silently picking the wrong project when a branch or display name is shared across projects — these now error and ask for the session ID instead of guessing.
