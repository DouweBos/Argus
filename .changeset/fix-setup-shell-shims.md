---
"argus": patch
---

Fix worktree setup commands not picking up mise / asdf / rbenv shims. Setup now runs in the user's shell so rc files load — previously it used a bare `/bin/sh`, which fell back to the system Ruby/Node.
