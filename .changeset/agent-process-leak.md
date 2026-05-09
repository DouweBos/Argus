---
"argus": patch
---

Fix agent subprocesses lingering after sessions end. Argus now SIGKILLs claude children that ignore SIGTERM, tears down all live agents on quit, and reaps orphans from previous runs at startup — so CPU and memory don't drift up over the day.
