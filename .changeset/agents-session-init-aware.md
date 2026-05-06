---
"argus": patch
---

Orchestrating agents now know that newly-created sessions take time to provision and won't immediately show their spawned agents — preventing duplicate worktrees from premature respawns after a flaky MCP transport.
