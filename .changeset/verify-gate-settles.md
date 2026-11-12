---
"argus": patch
# platforms: mac
---

Verify before finishing asks an agent to re-check a change only once: if it finishes anyway, later messages aren't held up over the same edits. Edits to `.argus.json` and `.claude/` no longer count, since no check in the app can cover them.
