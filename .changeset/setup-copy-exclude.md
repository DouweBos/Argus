---
"argus": minor
---

`setup.copy` and `setup.symlink` entries can now be objects of the form `{ "path": ".claude", "exclude": ["projects/**/worktrees/**"] }` to prune subdirectories from the copy/symlink expansion. Bare path strings still work — useful for keeping `.claude` cached without dragging Claude Code's per-session worktrees from the source branch into every new session.
