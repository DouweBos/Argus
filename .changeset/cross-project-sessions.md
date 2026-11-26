---
# platforms: mac, ios, android
"argus": minor
"@argus/peacock": minor
---

A session can span several projects: when a message links another project, Argus offers to give the session a worktree of it on the same branch, set up by that project. The agent works in every repository, the git view lists each one, and each is merged or opened as a pull request on its own; deleting the session removes every worktree.
