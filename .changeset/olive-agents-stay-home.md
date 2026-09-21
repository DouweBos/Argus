---
"argus": patch
---

Agents now keep related work in the checkout they're already in, instead of creating a worktree for every task. Unrelated work still gets its own worktree, and asking for one always works.
