---
"argus": minor
---

The new-session dialog now offers `origin/*` branches as the source for a fork. When the project root has a protected branch like `main` checked out, the dialog defaults to `origin/main` instead of the local copy so the new session always starts from the authoritative remote tip.
