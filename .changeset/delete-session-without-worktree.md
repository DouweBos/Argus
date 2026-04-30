---
"argus": patch
---

Deleting a session that failed to create its worktree no longer errors out. Argus now cleans up the leftover state instead of refusing the delete with a git "is not a working tree" message.
