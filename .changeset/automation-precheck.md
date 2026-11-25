---
"argus": minor
# platforms: mac, ios, android
---

Automations can run a precheck command before each run: when it exits non-zero or takes too long, the run is skipped with the command's output as the reason.
