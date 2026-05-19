---
"argus": patch
---

Fix MCP `list_sessions` returning the wrong project's sessions when an agent in a multi-project setup omitted `project_path`. Calls without `project_path` now error out when more than one project is registered instead of silently defaulting to the first.
