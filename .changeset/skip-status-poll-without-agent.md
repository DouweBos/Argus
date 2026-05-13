---
"argus": patch
---

The renderer's 5-second git-status safety poll now skips sessions without an attached agent — idle workspaces rely on filesystem events instead of constant shell-outs.
