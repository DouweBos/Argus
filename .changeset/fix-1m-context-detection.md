---
"argus": patch
---

Correctly detect the 1M-token context window for newer models like Opus 4.8, so the context usage indicator no longer reports against a 200k limit.
