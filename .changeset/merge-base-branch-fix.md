---
"argus": patch
---

Fixed a merge against a base like `origin/main` collapsing the session's commits before failing. The base is checked first, and a session pointed at a remote-tracking branch is repaired to the local branch behind it.
