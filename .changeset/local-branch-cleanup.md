---
"argus": minor
---

New built-in automation: Local branch cleanup. Weekly, it finds the local branches whose pull request already merged and whose remote is gone, and proposes each one for deletion with the exact command to run. Off by default, like every built-in.
