---
"argus": patch
---

Fix remote-control devices being unable to answer a permission prompt or question that was already waiting when they connected (or that survived a reconnect) — the answer silently did nothing. Pending prompts are now replayed to a device when it opens the agent, so approvals and question answers go through.
