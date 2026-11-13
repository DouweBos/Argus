---
"argus": minor
# platforms: mac, ios
---

Projects can run teardown commands before a session's worktree is deleted, such as stopping containers started in setup. The delete shows their output, and if one fails you can retry or delete anyway. Importing from Conductor brings its archive script along as the teardown.
