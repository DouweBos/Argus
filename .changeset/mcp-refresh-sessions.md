---
"argus": minor
# platforms: mac, ios
---

Agents can call `refresh_sessions` after creating a git worktree themselves, and any Argus tool that's given an unknown session rescans first, so a new worktree's run commands work straight away. The new worktree also shows up in the apps immediately.
