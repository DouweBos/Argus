---
"argus": patch
---

Stale worktrees deleted outside Argus (e.g. by Claude Code's Agent tool) are now pruned automatically, so the git view no longer fails to load with a "fatal: not a git repository" error after a sibling worktree directory was removed by hand.
