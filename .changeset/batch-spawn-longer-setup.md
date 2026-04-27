---
"argus": patch
---

`spawn_agents_batch` now waits up to 15 minutes for each new session to finish provisioning before launching its agent, instead of timing out after 2. Large repos whose `pnpm install` (or other setup steps) runs longer than two minutes no longer have their child agents silently skipped.
