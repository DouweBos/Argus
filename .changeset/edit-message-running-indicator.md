---
"argus": patch
---

Fix the running indicator disappearing after editing the last message in a chat. The agent restart triggered an exit event that flipped the indicator to stopped before the new run could light it up again.
