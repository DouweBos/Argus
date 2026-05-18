---
"argus": patch
---

Fix agents occasionally appearing in an immediate error state when starting. A prewarmed subprocess could be discarded mid-claim if the user navigated away, killing the just-claimed agent.
