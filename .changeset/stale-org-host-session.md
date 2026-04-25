---
"argus": patch
---

Fix new agent tabs vanishing on click in tasks whose on-disk host directory had been removed. The stale session is now pruned with a clear error instead of silently failing to spawn.
