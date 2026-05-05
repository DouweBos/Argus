---
"argus": patch
---

Fix terminal subprocesses leaking on app shutdown — node-pty spawn helpers no longer reparent to launchd and accumulate across Argus restarts.
