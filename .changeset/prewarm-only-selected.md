---
"argus": patch
---

Argus now keeps at most one Claude subprocess warmed up — for the currently selected session — instead of one per ready session. Avoids tens of idle subprocesses consuming gigabytes of memory in workspaces with many sessions.
