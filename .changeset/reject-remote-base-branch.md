---
"argus": patch
---

Reject remote-qualified base branches (e.g. `origin/main`) when setting a session's base or merging. Previously, merging a session whose base was a remote ref would silently create a bogus local branch literally named `origin/main` instead of updating the real base.
