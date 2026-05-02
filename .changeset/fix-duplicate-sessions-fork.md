---
"argus": patch
---

Forking a session no longer shows a duplicate row in the sidebar, gets stuck in "initializing", or starts the new agent with an empty conversation. The fork's reset, working-tree replay, and conversation truncation now run after the new worktree exists, so the resumed agent picks up where you left off.
