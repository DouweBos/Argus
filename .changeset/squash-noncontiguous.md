---
"argus": minor
---

Squashing selected commits no longer requires the selection to be contiguous. Non-selected commits in between replay on top of the squash; if that conflicts, the rebase is aborted and the error surfaced. Cmd-clicking an already selected commit in the git history now deselects it.
