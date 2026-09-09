---
"argus": patch
---

Fix worktrees getting stuck on "initializing" after a setup command like `pod install` finished successfully. Setup commands now run in a shell whose line editor can't garble them, and a setup command that goes silent for 20 minutes fails with an error instead of hanging forever.
