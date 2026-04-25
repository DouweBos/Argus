---
"argus": minor
---

Tasks now survive an Argus restart. The neutral host session is recreated against the existing host directory, so you can keep opening agents inside an old task. Host directories are pruned only when a task has been idle for 7 days.
