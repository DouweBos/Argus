---
"argus": patch
---

Stop mistakenly rewriting `git`, `ls`, and other commands that mention the conductor project path. Conductor device-flag injection now only fires for actual `conductor` CLI invocations, and a stalled simulator pool can no longer wedge agent tool approvals.
