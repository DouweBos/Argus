---
"argus": patch
# platforms: mac
---

An agent is no longer sent back to re-verify when it stops while its background subagents are still editing code; a subagent's edits only count once it finishes without verifying them.
